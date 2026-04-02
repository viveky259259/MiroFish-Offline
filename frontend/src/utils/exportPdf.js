/**
 * PDF Export Utility for MiroFish Prediction Reports
 *
 * Collects all report data (sections, agent logs, simulation profiles, posts)
 * and renders a complete print-ready HTML document, then triggers the
 * browser's native Save-as-PDF dialog.
 */

import service from '../api/index'

/* ─── helpers ────────────────────────────────────────────────────────────── */

async function safeFetch(path) {
  try {
    const res = await service.get(path)
    return res
  } catch {
    return null
  }
}

function esc(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mdToHtml(content) {
  if (!content) return ''
  let h = content

  // Remove leading ## header (shown separately as section title)
  h = h.replace(/^##\s+.+\n+/, '')

  // Code blocks
  h = h.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>')
  h = h.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Headings
  h = h.replace(/^#### (.+)$/gm, '<h5>$1</h5>')
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>')

  // Blockquotes
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

  // Lists
  h = h.replace(/^(\s*)- (.+)$/gm, '<li>$2</li>')
  h = h.replace(/^(\s*)\d+\. (.+)$/gm, '<li>$2</li>')
  h = h.replace(/(<li>[\s\S]*?<\/li>\s*)+/g, (m) =>
    m.includes('data-ol') ? `<ol>${m}</ol>` : `<ul>${m}</ul>`
  )

  // Bold / italic
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
  h = h.replace(/_(.+?)_/g, '<em>$1</em>')

  // HR
  h = h.replace(/^---$/gm, '<hr>')

  // Paragraphs
  h = h.replace(/\n\n/g, '</p><p>')
  h = h.replace(/\n/g, '<br>')
  h = '<p>' + h + '</p>'

  // Clean empty paragraphs and unwrap block-level tags
  h = h.replace(/<p><\/p>/g, '')
  h = h.replace(/<p>(<h[2-5])/g, '$1')
  h = h.replace(/(<\/h[2-5]>)<\/p>/g, '$1')
  h = h.replace(/<p>(<ul|<ol|<blockquote|<pre|<hr)/g, '$1')
  h = h.replace(/(<\/ul>|<\/ol>|<\/blockquote>|<\/pre>)<\/p>/g, '$1')
  h = h.replace(/<br>\s*(<ul|<ol|<blockquote)/g, '$1')
  h = h.replace(/(<\/ul>|<\/ol>|<\/blockquote>)\s*<br>/g, '$1')

  return h
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return iso
  }
}

function elapsed(startIso, endIso) {
  if (!startIso) return '—'
  const s = new Date(startIso)
  const e = endIso ? new Date(endIso) : new Date()
  const sec = Math.round((e - s) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min}m ${rem}s`
}

/* ─── section builders ───────────────────────────────────────────────────── */

function buildCoverPage(reportOutline, reportId, simulationId, runStatus) {
  const title = esc(reportOutline?.title || 'Prediction Report')
  const summary = esc(reportOutline?.summary || '')
  const dateStr = formatDate(runStatus?.completed_at || runStatus?.started_at || new Date().toISOString())

  return `
<div class="page cover-page">
  <div class="cover-brand">MIROFISH OFFLINE</div>
  <div class="cover-tag">AI Social Simulation · Prediction Report</div>
  <h1 class="cover-title">${title}</h1>
  ${summary ? `<p class="cover-summary">${summary}</p>` : ''}
  <div class="cover-meta">
    <div class="cover-meta-row"><span class="meta-label">Report ID</span><span class="meta-val mono">${esc(reportId)}</span></div>
    ${simulationId ? `<div class="cover-meta-row"><span class="meta-label">Simulation ID</span><span class="meta-val mono">${esc(simulationId)}</span></div>` : ''}
    <div class="cover-meta-row"><span class="meta-label">Generated</span><span class="meta-val">${dateStr}</span></div>
    ${runStatus ? `<div class="cover-meta-row"><span class="meta-label">Sections</span><span class="meta-val">${reportOutline?.sections?.length || 0} completed</span></div>` : ''}
  </div>
  <div class="cover-footer">Confidential · AI-Generated Analysis</div>
</div>`
}

function buildToc(sections) {
  if (!sections?.length) return ''
  const items = sections.map((s, i) =>
    `<div class="toc-item">
       <span class="toc-num">${String(i + 1).padStart(2, '0')}</span>
       <span class="toc-title">${esc(s.title)}</span>
       <span class="toc-dots"></span>
     </div>`
  ).join('\n')

  return `
<div class="page toc-page">
  <h2 class="section-heading">Table of Contents</h2>
  <div class="toc-list">
    ${items}
    <div class="toc-item toc-extra"><span class="toc-num">—</span><span class="toc-title">Agents Spawned</span></div>
    <div class="toc-item toc-extra"><span class="toc-num">—</span><span class="toc-title">Simulation Activity</span></div>
    <div class="toc-item toc-extra"><span class="toc-num">—</span><span class="toc-title">Conversations</span></div>
    <div class="toc-item toc-extra"><span class="toc-num">—</span><span class="toc-title">AI Research Workflow</span></div>
  </div>
</div>`
}

function buildReportSections(sections, generatedSections) {
  if (!sections?.length) return ''

  return sections.map((s, i) => {
    const idx = i + 1
    const content = generatedSections[idx]
    return `
<div class="page report-section-page">
  <div class="rs-header">
    <span class="rs-number">${String(idx).padStart(2, '0')}</span>
    <h2 class="rs-title">${esc(s.title)}</h2>
  </div>
  <div class="rs-body">
    ${content ? mdToHtml(content) : '<p class="no-content">Content not available.</p>'}
  </div>
</div>`
  }).join('\n')
}

function buildAgentsSection(profiles) {
  if (!profiles?.length) return ''

  const TYPE_COLORS = {
    AIScientist: '#6366F1', Developer: '#0EA5E9', ProductManager: '#F59E0B',
    AIEngineer: '#10B981', DirectorOfEngineering: '#8B5CF6', RDEngineer: '#EF4444',
    Organization: '#6B7280', StartupFounder: '#F97316', TechStartup: '#14B8A6',
    Person: '#84CC16'
  }

  const cards = profiles.map(p => {
    const type = esc(p.type || p.profession || p.mbti || 'Agent')
    const color = TYPE_COLORS[type] || '#6B7280'
    const name = esc(p.name || p.username || 'Unknown')
    const handle = p.username ? `@${esc(p.username)}` : ''
    // Build a profession label from available fields
    const professionParts = [p.profession, p.age ? `Age ${p.age}` : '', p.country].filter(Boolean)
    const profession = esc(professionParts.join(' · '))
    const bio = esc(p.bio || p.user_profile || '')
    const topics = Array.isArray(p.interested_topics)
      ? p.interested_topics.slice(0, 4).map(t => `<span class="topic-tag">${esc(t)}</span>`).join('')
      : ''

    const mbti = p.mbti ? `<span class="mbti-badge">${esc(p.mbti)}</span>` : ''

    return `
<div class="agent-card">
  <div class="agent-card-header">
    <div class="agent-avatar" style="background:${color}20;color:${color}">${name.charAt(0).toUpperCase()}</div>
    <div class="agent-info">
      <div class="agent-name">${name}</div>
      ${handle ? `<div class="agent-handle">${handle}</div>` : ''}
      <div class="agent-badges">${mbti}<div class="agent-type-badge" style="background:${color}20;color:${color}">${type}</div></div>
    </div>
  </div>
  ${profession ? `<div class="agent-profession">${profession}</div>` : ''}
  ${bio ? `<p class="agent-bio">${bio.length > 280 ? bio.slice(0, 280) + '…' : bio}</p>` : ''}
  ${topics ? `<div class="agent-topics">${topics}</div>` : ''}
</div>`
  }).join('\n')

  return `
<div class="page agents-page">
  <h2 class="section-heading">Agents Spawned</h2>
  <p class="section-subtitle">${profiles.length} simulated agents participated in this simulation</p>
  <div class="agents-grid">
    ${cards}
  </div>
</div>`
}

function buildSimulationOverview(runStatus, simConfig) {
  if (!runStatus) return ''

  const rows = [
    ['Status', runStatus.runner_status === 'completed' ? '✓ Completed' : runStatus.runner_status || '—'],
    ['Total Rounds', `${runStatus.current_round || 0} / ${runStatus.total_rounds || 0}`],
    ['Simulated Hours', runStatus.total_simulation_hours || '—'],
    ['Total Actions', runStatus.total_actions_count || 0],
    ['Twitter Actions', runStatus.twitter_actions_count || 0],
    ['Reddit Actions', runStatus.reddit_actions_count || 0],
    ['Duration', elapsed(runStatus.started_at, runStatus.completed_at)],
    ['Started', formatDate(runStatus.started_at)],
    ['Completed', formatDate(runStatus.completed_at)],
  ].map(([k, v]) => `<tr><td class="stat-key">${esc(k)}</td><td class="stat-val">${esc(String(v))}</td></tr>`).join('\n')

  let configBlock = ''
  if (simConfig) {
    const topic = simConfig.hot_topics?.[0]?.description || simConfig.topic || ''
    const narrative = simConfig.narrative_direction || ''
    if (topic) configBlock += `<div class="sim-field"><span class="sim-field-label">Primary Topic</span><p>${esc(topic)}</p></div>`
    if (narrative) configBlock += `<div class="sim-field"><span class="sim-field-label">Narrative Direction</span><p>${esc(narrative)}</p></div>`
  }

  return `
<div class="sim-overview-block">
  <h3 class="sub-heading">Simulation Statistics</h3>
  <table class="stat-table"><tbody>${rows}</tbody></table>
  ${configBlock}
</div>`
}

function buildPostsSection(posts) {
  const twitterPosts = posts?.twitter || []
  const redditPosts = posts?.reddit || []
  if (!twitterPosts.length && !redditPosts.length) return ''

  const renderPosts = (list, platform) => {
    if (!list.length) return ''
    const icon = platform === 'Twitter'
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`
    const items = list.slice(0, 15).map(p => `
<div class="post-item">
  <div class="post-content">${esc(p.content || p.body || '')}</div>
  <div class="post-meta">
    <span class="post-agent">Agent #${p.user_id ?? '?'}</span>
    ${p.num_likes ? `<span>♡ ${p.num_likes}</span>` : ''}
    ${p.num_shares ? `<span>↺ ${p.num_shares}</span>` : ''}
  </div>
</div>`).join('')

    return `
<div class="platform-posts">
  <div class="platform-label">${icon} ${platform} <span class="post-count">${list.length} posts</span></div>
  ${items}
</div>`
  }

  return `
<div class="page activity-page">
  <h2 class="section-heading">Simulation Activity</h2>
  <div class="posts-columns">
    ${renderPosts(twitterPosts, 'Twitter')}
    ${renderPosts(redditPosts, 'Reddit')}
  </div>
</div>`
}

function buildChatsSection(chatHistoryCache, surveyResults, componentProfiles) {
  const hasChats = chatHistoryCache && Object.values(chatHistoryCache).some(h => h?.length > 0)
  const hasSurvey = surveyResults?.length > 0
  if (!hasChats && !hasSurvey) return ''

  // Helper to get a display name for a chat key
  const keyToName = (key) => {
    if (key === 'report_agent') return { name: 'Report Agent', role: 'AI Research Assistant', isAgent: false }
    const idx = parseInt(key.replace('agent_', ''))
    const p = componentProfiles?.[idx]
    return {
      name: p?.name || p?.username || `Agent ${idx}`,
      role: p?.profession || p?.type || '',
      isAgent: true,
    }
  }

  let html = `<div class="page chats-page">
  <h2 class="section-heading">Conversations</h2>`

  // ── Chat histories ──────────────────────────────────────────────────────
  if (hasChats) {
    const entries = Object.entries(chatHistoryCache).filter(([, msgs]) => msgs?.length > 0)

    entries.forEach(([key, messages]) => {
      const { name, role, isAgent } = keyToName(key)
      const avatarColor = isAgent ? '#6366F1' : '#10B981'
      const initial = name.charAt(0).toUpperCase()

      html += `
  <div class="chat-thread">
    <div class="chat-thread-header">
      <div class="chat-avatar" style="background:${avatarColor}20;color:${avatarColor}">${initial}</div>
      <div>
        <div class="chat-thread-name">${esc(name)}</div>
        ${role ? `<div class="chat-thread-role">${esc(role)}</div>` : ''}
      </div>
      <div class="chat-msg-count">${messages.length} messages</div>
    </div>
    <div class="chat-messages-list">`

      messages.forEach(msg => {
        const isUser = msg.role === 'user'
        const label = isUser ? 'You' : esc(name)
        const bubbleClass = isUser ? 'bubble-user' : 'bubble-agent'
        // Truncate very long messages (e.g. pasted markdown docs)
        const content = esc(String(msg.content || ''))
        html += `
      <div class="chat-message ${bubbleClass}">
        <span class="chat-msg-label">${label}</span>
        <div class="chat-msg-body">${content}</div>
      </div>`
      })

      html += `
    </div>
  </div>`
    })
  }

  // ── Survey results ──────────────────────────────────────────────────────
  if (hasSurvey) {
    // Group by question (in case multiple surveys were run)
    const grouped = {}
    surveyResults.forEach(r => {
      const q = r.question || 'Survey'
      if (!grouped[q]) grouped[q] = []
      grouped[q].push(r)
    })

    Object.entries(grouped).forEach(([question, results]) => {
      html += `
  <div class="survey-block">
    <div class="survey-question-header">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>
      Survey Question
    </div>
    <div class="survey-question">${esc(question)}</div>
    <div class="survey-responses">`

      results.forEach(r => {
        html += `
      <div class="survey-response">
        <div class="survey-agent-name">${esc(r.agent_name || `Agent ${r.agent_id}`)}</div>
        ${r.profession ? `<div class="survey-agent-role">${esc(r.profession)}</div>` : ''}
        <p class="survey-answer">${esc(r.answer || 'No response')}</p>
      </div>`
      })

      html += `
    </div>
  </div>`
    })
  }

  html += `\n</div>`
  return html
}

function buildWorkflowSection(agentLogs, totalToolCalls) {
  if (!agentLogs?.length) return ''

  const LABELS = {
    report_start: 'Report Started', planning_start: 'Planning Started',
    planning_complete: 'Plan Complete', section_start: 'Section Start',
    section_content: 'Content Ready', section_complete: 'Section Done',
    tool_call: 'Tool Call', tool_result: 'Tool Result',
    llm_response: 'LLM Response', report_complete: 'Complete'
  }

  // Only show milestone events (skip individual llm_response spam)
  const milestone = (l) => ['report_start', 'planning_start', 'planning_complete', 'section_start', 'section_complete', 'tool_call', 'report_complete'].includes(l.action)
  const displayed = agentLogs.filter(milestone)

  const items = displayed.map((log, i) => {
    const label = LABELS[log.action] || log.action
    const isLast = i === displayed.length - 1
    const isMilestone = log.action === 'section_complete' || log.action === 'report_complete' || log.action === 'planning_complete'

    let detail = ''
    if (log.action === 'report_start' && log.details?.simulation_requirement) {
      detail = `<div class="wf-detail">${esc(String(log.details.simulation_requirement).slice(0, 120))}…</div>`
    } else if (log.action === 'section_start' || log.action === 'section_complete') {
      const title = log.section_title || log.details?.section_title || ''
      detail = title ? `<div class="wf-detail">#${log.section_index} — ${esc(title)}</div>` : ''
    } else if (log.action === 'tool_call') {
      const tool = log.details?.tool_name || ''
      detail = tool ? `<div class="wf-detail tool-name">${esc(tool)}</div>` : ''
    } else if (log.action === 'planning_complete') {
      const count = log.details?.outline?.sections?.length
      if (count) detail = `<div class="wf-detail">${count} sections planned</div>`
    }

    const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false }) : ''
    const dotClass = isMilestone ? 'wf-dot-milestone' : 'wf-dot-normal'

    return `
<div class="wf-row ${isMilestone ? 'wf-milestone' : ''}">
  <div class="wf-connector">
    <div class="wf-dot ${dotClass}"></div>
    ${!isLast ? '<div class="wf-line"></div>' : ''}
  </div>
  <div class="wf-content">
    <div class="wf-title-row">
      <span class="wf-label">${esc(label)}</span>
      ${time ? `<span class="wf-time">${time}</span>` : ''}
    </div>
    ${detail}
  </div>
</div>`
  }).join('\n')

  return `
<div class="page workflow-page">
  <h2 class="section-heading">AI Research Workflow</h2>
  <p class="section-subtitle">${agentLogs.length} log events · ${totalToolCalls || 0} tool calls executed</p>
  <div class="workflow-timeline">
    ${items}
  </div>
</div>`
}

/* ─── CSS ────────────────────────────────────────────────────────────────── */

function buildCss() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Lora:ital,wght@0,400;0,600;0,700;1,400&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.65;
      color: #1a1a1a;
      background: #fff;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm 18mm 16mm 18mm;
      margin: 0 auto;
      page-break-after: always;
      position: relative;
      border-bottom: 1px solid #f0f0f0;
    }
    .page:last-child { page-break-after: avoid; border-bottom: none; }

    /* ── Cover ── */
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      background: #fff;
      padding: 28mm 20mm;
    }
    .cover-brand {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 3px;
      color: #9ca3af;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .cover-tag {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 32px;
      letter-spacing: 0.5px;
    }
    .cover-title {
      font-family: 'Lora', Georgia, serif;
      font-size: 34px;
      font-weight: 700;
      line-height: 1.25;
      color: #111827;
      margin-bottom: 20px;
      max-width: 160mm;
    }
    .cover-summary {
      font-size: 15px;
      color: #4b5563;
      line-height: 1.7;
      max-width: 145mm;
      margin-bottom: 40px;
      font-family: 'Lora', Georgia, serif;
      font-style: italic;
    }
    .cover-meta {
      border-top: 1px solid #e5e7eb;
      padding-top: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .cover-meta-row {
      display: flex;
      align-items: baseline;
      gap: 16px;
    }
    .meta-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #9ca3af;
      width: 110px;
      flex-shrink: 0;
    }
    .meta-val { font-size: 13px; color: #374151; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .cover-footer {
      position: absolute;
      bottom: 16mm;
      left: 20mm;
      right: 20mm;
      font-size: 10px;
      color: #9ca3af;
      border-top: 1px solid #f3f4f6;
      padding-top: 10px;
    }

    /* ── TOC ── */
    .toc-page {}
    .toc-list { margin-top: 24px; display: flex; flex-direction: column; gap: 0; }
    .toc-item {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .toc-extra { opacity: 0.55; }
    .toc-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #9ca3af;
      width: 28px;
      flex-shrink: 0;
    }
    .toc-title { font-size: 14px; color: #374151; flex: 1; }
    .toc-dots { flex: 0; }

    /* ── Report Sections ── */
    .report-section-page {}
    .rs-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 28px;
      padding-bottom: 16px;
      border-bottom: 2px solid #111827;
    }
    .rs-number {
      font-family: 'JetBrains Mono', monospace;
      font-size: 32px;
      font-weight: 700;
      color: #d1d5db;
      line-height: 1;
      margin-top: 4px;
      flex-shrink: 0;
    }
    .rs-title {
      font-family: 'Lora', Georgia, serif;
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      line-height: 1.3;
    }
    .rs-body { font-family: 'Lora', Georgia, serif; font-size: 14px; line-height: 1.8; }
    .rs-body h2, .rs-body h3, .rs-body h4, .rs-body h5 {
      font-family: 'Inter', sans-serif;
      margin-top: 24px;
      margin-bottom: 10px;
      color: #111827;
    }
    .rs-body h2 { font-size: 18px; border-bottom: 1px solid #f3f4f6; padding-bottom: 6px; }
    .rs-body h3 { font-size: 16px; }
    .rs-body h4 { font-size: 14px; }
    .rs-body p { margin: 12px 0; }
    .rs-body ul, .rs-body ol { padding-left: 22px; margin: 10px 0; }
    .rs-body li { margin: 5px 0; }
    .rs-body blockquote {
      border-left: 3px solid #e5e7eb;
      padding-left: 16px;
      margin: 16px 0;
      color: #6b7280;
      font-style: italic;
    }
    .rs-body strong { font-weight: 700; color: #111827; }
    .rs-body em { font-style: italic; }
    .rs-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    .rs-body pre.code-block {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      overflow: auto;
      margin: 14px 0;
      line-height: 1.6;
    }
    .rs-body code.inline-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      background: #f3f4f6;
      padding: 2px 5px;
      border-radius: 3px;
    }
    .no-content { color: #9ca3af; font-style: italic; }

    /* ── Section headings ── */
    .section-heading {
      font-family: 'Inter', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 6px;
      padding-bottom: 12px;
      border-bottom: 2px solid #111827;
    }
    .sub-heading {
      font-size: 16px;
      font-weight: 600;
      color: #374151;
      margin: 24px 0 12px;
    }
    .section-subtitle {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 24px;
      margin-top: 4px;
    }

    /* ── Agents ── */
    .agents-page {}
    .agents-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 8px;
    }
    .agent-card {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 16px;
      background: #fafafa;
      break-inside: avoid;
    }
    .agent-card-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
    }
    .agent-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      flex-shrink: 0;
    }
    .agent-info { flex: 1; min-width: 0; }
    .agent-name { font-weight: 700; font-size: 13px; color: #111827; line-height: 1.3; }
    .agent-handle { font-size: 11px; color: #9ca3af; font-family: 'JetBrains Mono', monospace; }
    .agent-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
      align-items: center;
    }
    .agent-type-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 20px;
      letter-spacing: 0.3px;
    }
    .mbti-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 20px;
      background: #fef3c7;
      color: #92400e;
      font-family: 'JetBrains Mono', monospace;
    }
    .agent-profession {
      font-size: 12px;
      color: #4b5563;
      font-weight: 500;
      margin-bottom: 6px;
    }
    .agent-bio {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.55;
      margin-bottom: 8px;
    }
    .agent-topics { display: flex; flex-wrap: wrap; gap: 4px; }
    .topic-tag {
      font-size: 10px;
      padding: 2px 7px;
      background: #f3f4f6;
      color: #4b5563;
      border-radius: 20px;
    }

    /* ── Simulation Overview ── */
    .sim-overview-block { margin-top: 20px; }
    .stat-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .stat-table tr { border-bottom: 1px solid #f3f4f6; }
    .stat-key {
      padding: 10px 16px 10px 0;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      width: 45%;
    }
    .stat-val {
      padding: 10px 0;
      font-size: 14px;
      color: #111827;
    }
    .sim-field { margin: 12px 0 16px; }
    .sim-field-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 4px;
    }
    .sim-field p { font-size: 13px; color: #374151; line-height: 1.6; }

    /* ── Activity / Posts ── */
    .activity-page {}
    .posts-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-top: 8px;
      align-items: start;
    }
    .platform-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: #374151;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #111827;
    }
    .post-count { font-weight: 400; color: #9ca3af; margin-left: 4px; }
    .post-item {
      padding: 10px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .post-content { font-size: 12px; color: #1f2937; line-height: 1.55; margin-bottom: 5px; }
    .post-meta {
      display: flex;
      gap: 10px;
      font-size: 10px;
      color: #9ca3af;
      font-family: 'JetBrains Mono', monospace;
    }

    /* ── Workflow Timeline ── */
    .workflow-page {}
    .workflow-timeline {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
    }
    .wf-row {
      display: flex;
      gap: 14px;
    }
    .wf-connector {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 16px;
      flex-shrink: 0;
    }
    .wf-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 4px;
    }
    .wf-dot-normal { background: #d1d5db; }
    .wf-dot-milestone { background: #111827; }
    .wf-line { flex: 1; width: 1px; background: #e5e7eb; min-height: 16px; }
    .wf-content { flex: 1; padding-bottom: 14px; }
    .wf-milestone > .wf-content { padding-bottom: 18px; }
    .wf-title-row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 2px;
    }
    .wf-label {
      font-size: 12px;
      font-weight: 600;
      color: #374151;
    }
    .wf-milestone .wf-label { color: #111827; font-weight: 700; }
    .wf-time {
      font-size: 10px;
      color: #9ca3af;
      font-family: 'JetBrains Mono', monospace;
    }
    .wf-detail {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.5;
    }
    .wf-detail.tool-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #6366f1;
    }

    /* ── Chats ── */
    .chats-page {}
    .chat-thread {
      margin: 20px 0 28px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
      break-inside: avoid;
    }
    .chat-thread-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    .chat-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      flex-shrink: 0;
    }
    .chat-thread-name { font-size: 13px; font-weight: 700; color: #111827; }
    .chat-thread-role { font-size: 11px; color: #6b7280; margin-top: 1px; }
    .chat-msg-count {
      margin-left: auto;
      font-size: 11px;
      color: #9ca3af;
      font-family: 'JetBrains Mono', monospace;
    }
    .chat-messages-list {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .chat-message { display: flex; flex-direction: column; gap: 3px; }
    .chat-msg-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #9ca3af;
    }
    .bubble-user .chat-msg-label { color: #6366f1; }
    .bubble-agent .chat-msg-label { color: #10b981; }
    .chat-msg-body {
      font-size: 12px;
      color: #1f2937;
      line-height: 1.6;
      padding: 8px 12px;
      border-radius: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bubble-user .chat-msg-body { background: #eef2ff; }
    .bubble-agent .chat-msg-body { background: #f9fafb; border: 1px solid #e5e7eb; }

    /* ── Survey ── */
    .survey-block {
      margin: 20px 0 28px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
      break-inside: avoid;
    }
    .survey-question-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px 6px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #9ca3af;
      background: #f9fafb;
      border-bottom: 1px solid #f3f4f6;
    }
    .survey-question {
      padding: 10px 16px 12px;
      font-size: 14px;
      font-weight: 600;
      color: #111827;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    .survey-responses {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }
    .survey-response {
      padding: 12px 16px;
      border-bottom: 1px solid #f3f4f6;
      border-right: 1px solid #f3f4f6;
    }
    .survey-response:nth-child(even) { border-right: none; }
    .survey-agent-name { font-size: 12px; font-weight: 700; color: #374151; }
    .survey-agent-role { font-size: 11px; color: #9ca3af; margin-bottom: 5px; }
    .survey-answer { font-size: 12px; color: #4b5563; line-height: 1.6; margin-top: 4px; }

    /* ── Page number footer ── */
    @page {
      size: A4;
      margin: 0;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { border-bottom: none; }
    }
  `
}

/* ─── main export function ───────────────────────────────────────────────── */

export async function exportReportPdf({
  reportId,
  simulationId,
  reportOutline,
  generatedSections,
  agentLogs,
  totalToolCalls,
  chatHistoryCache,
  surveyResults,
  componentProfiles,
}) {
  // ── 1. Fetch supplemental data ──────────────────────────────────────────
  let profiles = []
  let posts = { twitter: [], reddit: [] }
  let runStatus = null
  let simConfig = null

  if (simulationId) {
    const [twitterProfilesRes, redditProfilesRes, twitterPostsRes, redditPostsRes, statusRes, configRes] =
      await Promise.allSettled([
        safeFetch(`/api/simulation/${simulationId}/profiles?platform=twitter`),
        safeFetch(`/api/simulation/${simulationId}/profiles?platform=reddit`),
        safeFetch(`/api/simulation/${simulationId}/posts?platform=twitter&limit=20`),
        safeFetch(`/api/simulation/${simulationId}/posts?platform=reddit&limit=20`),
        safeFetch(`/api/simulation/${simulationId}/run-status`),
        safeFetch(`/api/simulation/${simulationId}/config`),
      ])

    const seen = new Set()
    const addProfiles = (res) => {
      if (res.status !== 'fulfilled' || !res.value) return
      const list = res.value.data?.profiles || res.value.profiles || []
      list.forEach(p => {
        const key = p.username || p.name || JSON.stringify(p)
        if (!seen.has(key)) { seen.add(key); profiles.push(p) }
      })
    }
    addProfiles(twitterProfilesRes)
    addProfiles(redditProfilesRes)

    const extractPosts = (res) => {
      if (res.status !== 'fulfilled' || !res.value) return []
      return res.value.data?.posts || res.value.posts || []
    }
    posts.twitter = extractPosts(twitterPostsRes)
    posts.reddit = extractPosts(redditPostsRes)

    if (statusRes.status === 'fulfilled' && statusRes.value) {
      runStatus = statusRes.value.data || statusRes.value
    }
    if (configRes.status === 'fulfilled' && configRes.value) {
      simConfig = configRes.value.data || configRes.value
    }
  }

  // ── 2. Build HTML document ──────────────────────────────────────────────
  const sections = reportOutline?.sections || []

  // Simulation Overview + Agents on one page (overview) then agents get their own page
  const overviewPage = (runStatus || simConfig)
    ? `<div class="page">
         <h2 class="section-heading">Simulation Overview</h2>
         ${buildSimulationOverview(runStatus, simConfig)}
       </div>`
    : ''

  const body = [
    buildCoverPage(reportOutline, reportId, simulationId, runStatus),
    buildToc(sections),
    buildReportSections(sections, generatedSections),
    overviewPage,
    buildAgentsSection(profiles),
    buildPostsSection(posts),
    buildChatsSection(chatHistoryCache, surveyResults, componentProfiles || profiles),
    buildWorkflowSection(agentLogs, totalToolCalls),
  ].filter(Boolean).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(reportOutline?.title || 'Prediction Report')} — MiroFish</title>
  <style>${buildCss()}</style>
</head>
<body>
${body}
</body>
</html>`

  // ── 3. Open print window ────────────────────────────────────────────────
  const win = window.open('', '_blank', 'width=960,height=720,scrollbars=yes')
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this page and try again.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  // Brief delay to allow fonts/styles to load before print dialog
  setTimeout(() => win.print(), 800)
}
