"""
LLM Client Wrapper
Unified OpenAI format API calls
Supports Ollama num_ctx parameter to prevent prompt truncation
Includes rate limiting for Groq free tier (60 RPM, 6K TPM)
"""

import json
import logging
import os
import re
import time
import threading
from typing import Optional, Dict, Any, List
from openai import OpenAI, RateLimitError

from ..config import Config

logger = logging.getLogger('mirofish.llm')


class _RateLimiter:
    """Sliding-window rate limiter for RPM and TPM."""

    def __init__(self, rpm: int = 60, tpm: int = 6000):
        self.rpm = rpm
        self.tpm = tpm
        self._lock = threading.Lock()
        self._request_timestamps: List[float] = []
        self._token_log: List[tuple] = []  # (timestamp, token_count)

    def wait_if_needed(self, estimated_tokens: int = 0) -> None:
        """Block until the next request fits within rate limits."""
        with self._lock:
            now = time.time()
            window = 60.0

            # Prune old entries
            self._request_timestamps = [
                t for t in self._request_timestamps if now - t < window
            ]
            self._token_log = [
                (t, c) for t, c in self._token_log if now - t < window
            ]

            # Check RPM
            if len(self._request_timestamps) >= self.rpm:
                sleep_until = self._request_timestamps[0] + window
                wait = sleep_until - now
                if wait > 0:
                    logger.info(f"Rate limit: waiting {wait:.1f}s (RPM)")
                    time.sleep(wait)
                    now = time.time()
                    self._request_timestamps = [
                        t for t in self._request_timestamps if now - t < window
                    ]
                    self._token_log = [
                        (t, c) for t, c in self._token_log if now - t < window
                    ]

            # Check TPM
            current_tokens = sum(c for _, c in self._token_log)
            if estimated_tokens and current_tokens + estimated_tokens > self.tpm:
                if self._token_log:
                    sleep_until = self._token_log[0][0] + window
                    wait = sleep_until - now
                    if wait > 0:
                        logger.info(f"Rate limit: waiting {wait:.1f}s (TPM)")
                        time.sleep(wait)

            self._request_timestamps.append(time.time())
            if estimated_tokens:
                self._token_log.append((time.time(), estimated_tokens))

    def record_tokens(self, token_count: int) -> None:
        """Record actual token usage after a response."""
        with self._lock:
            self._token_log.append((time.time(), token_count))


# Shared rate limiter across all LLMClient instances
_global_rate_limiter: Optional[_RateLimiter] = None
_limiter_lock = threading.Lock()


def _get_rate_limiter() -> _RateLimiter:
    global _global_rate_limiter
    with _limiter_lock:
        if _global_rate_limiter is None:
            rpm = int(os.environ.get('GROQ_RPM', '30'))
            tpm = int(os.environ.get('GROQ_TPM', '6000'))
            _global_rate_limiter = _RateLimiter(rpm=rpm, tpm=tpm)
        return _global_rate_limiter


class LLMClient:
    """LLM Client"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: float = 300.0
    ):
        self.api_key = api_key or Config.LLM_API_KEY
        self.base_url = base_url or Config.LLM_BASE_URL
        self.model = model or Config.LLM_MODEL_NAME

        if not self.api_key:
            raise ValueError("LLM_API_KEY not configured")

        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=timeout,
        )

        # Ollama context window size — prevents prompt truncation.
        # Read from env OLLAMA_NUM_CTX, default 8192 (Ollama default is only 2048).
        self._num_ctx = int(os.environ.get('OLLAMA_NUM_CTX', '8192'))

        # Max retries on rate limit errors
        self._max_retries = 3

    def _is_ollama(self) -> bool:
        """Check if we're talking to an Ollama server."""
        return '11434' in (self.base_url or '')

    def _is_groq(self) -> bool:
        """Check if we're talking to Groq API."""
        return 'groq.com' in (self.base_url or '')

    def _estimate_tokens(self, messages: List[Dict[str, str]]) -> int:
        """Rough token estimate: ~4 chars per token."""
        total_chars = sum(len(m.get('content', '')) for m in messages)
        return total_chars // 4

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        response_format: Optional[Dict] = None
    ) -> str:
        """
        Send chat request

        Args:
            messages: Message list
            temperature: Temperature parameter
            max_tokens: Max token count
            response_format: Response format (e.g., JSON mode)

        Returns:
            Model response text
        """
        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        if response_format:
            kwargs["response_format"] = response_format

        # For Ollama: pass num_ctx via extra_body to prevent prompt truncation
        if self._is_ollama() and self._num_ctx:
            kwargs["extra_body"] = {
                "options": {"num_ctx": self._num_ctx}
            }

        # Rate limiting for Groq — only estimate input tokens for pre-flight;
        # actual total usage is recorded after the response.
        if self._is_groq():
            limiter = _get_rate_limiter()
            estimated = self._estimate_tokens(messages)
            limiter.wait_if_needed(estimated)

        # Retry loop for rate limit errors
        for attempt in range(self._max_retries):
            try:
                response = self.client.chat.completions.create(**kwargs)
                content = response.choices[0].message.content

                # Record actual token usage
                if self._is_groq() and response.usage:
                    limiter = _get_rate_limiter()
                    limiter.record_tokens(response.usage.total_tokens)

                # Some models include <think> content in response, need to remove
                content = re.sub(r'<think>[\s\S]*?</think>', '', content).strip()
                return content

            except RateLimitError as e:
                if attempt < self._max_retries - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(
                        f"Groq rate limit hit, retrying in {wait}s "
                        f"(attempt {attempt + 1}/{self._max_retries})"
                    )
                    time.sleep(wait)
                else:
                    raise

    def chat_json(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096
    ) -> Dict[str, Any]:
        """
        Send chat request and return JSON

        Args:
            messages: Message list
            temperature: Temperature parameter
            max_tokens: Max token count

        Returns:
            Parsed JSON object
        """
        response = self.chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"}
        )
        # Clean markdown code block markers
        cleaned_response = response.strip()
        cleaned_response = re.sub(r'^```(?:json)?\s*\n?', '', cleaned_response, flags=re.IGNORECASE)
        cleaned_response = re.sub(r'\n?```\s*$', '', cleaned_response)
        cleaned_response = cleaned_response.strip()

        try:
            return json.loads(cleaned_response)
        except json.JSONDecodeError:
            raise ValueError(f"Invalid JSON format from LLM: {cleaned_response}")
