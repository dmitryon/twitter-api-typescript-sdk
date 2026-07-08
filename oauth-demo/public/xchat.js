window.XChatUI = (() => {
  let state = { integrationId: null, appId: null, auth: 'oauth2', conversations: [], currentConversation: null, messages: [], userId: null, nextToken: null, replyTo: null };
  const userCache = {};

  function getModal() {
    let modal = document.getElementById('xchatModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'xchatModal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-content xchat-dialog">
          <div class="xchat-header">
            <h2>🔐 X Chat</h2>
            <span class="close" onclick="XChatUI.close()">&times;</span>
          </div>
          <div class="xchat-tabs">
            <button class="xchat-tab active" onclick="XChatUI.showTab('conversations')">Conversations</button>
            <button class="xchat-tab" onclick="XChatUI.showTab('keys')">🔑 Keys</button>
            <button class="xchat-tab" onclick="XChatUI.showTab('xaa')">XAA Subscriptions</button>
          </div>
          <div id="xchatContent" class="xchat-content"></div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    return modal;
  }

  function open(integrationId, integration) {
    state.integrationId = integrationId;
    state.appId = integration?.appId || null;
    state.auth = 'oauth2';
    const modal = getModal();
    modal.style.display = 'block';
    checkPinAndShow();
  }

  async function checkPinAndShow() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Checking X Chat settings...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/settings?auth=${state.auth}`);
      const data = await res.json();
      if (data.xchat?.user_id) state.userId = data.xchat.user_id;

      if (data.xchat?.has_private_key) {
        // Keys cached locally — ready to go
        showTab('conversations');
      } else if (!data.xchat?.has_pin) {
        // No PIN set yet
        renderPinPrompt(data.xchat?.needs_registration);
      } else if (data.xchat?.needs_registration) {
        // Has PIN but no keys on server — needs registration
        renderRegistrationPrompt();
      } else {
        // Has PIN, keys on server — attempt unlock
        await attemptUnlock();
      }
    } catch (e) {
      renderPinPrompt(false);
    }
  }

  function renderPinPrompt(needsRegistration) {
    const content = document.getElementById('xchatContent');
    const title = needsRegistration ? '🔐 Set Up X Chat Encryption' : '🔐 X Chat PIN Required';
    const desc = needsRegistration
      ? 'Choose a 4-digit PIN to protect your encryption keys. This PIN will be used to recover your keys on other devices.'
      : 'Enter the 4-digit numeric PIN you set up in the X app\'s Chat settings (Settings → Privacy → Direct Messages → Set passcode).';
    content.innerHTML = `
      <div class="xchat-pin-section">
        <h3>${title}</h3>
        <p>${desc}</p>
        <div class="xchat-pin-form">
          <input type="password" id="xchatPinInput" placeholder="••••" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" autocomplete="off">
          <button class="btn btn-primary" onclick="XChatUI.savePin()">Save PIN</button>
        </div>
        <p class="hint">${needsRegistration ? 'This will generate new encryption keys and register them with X.' : 'Your PIN is stored securely on this server.'}</p>
      </div>
    `;
    setTimeout(() => {
      const input = document.getElementById('xchatPinInput');
      if (input) {
        input.focus();
        input.addEventListener('input', () => {
          if (input.value.length === 4) XChatUI.savePin();
        });
      }
    }, 50);
  }

  function renderRegistrationPrompt() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = `
      <div class="xchat-pin-section">
        <h3>🔑 Set Up X Chat Encryption</h3>
        <p>Your account doesn't have encryption keys registered yet. Click below to generate keys and register them with X.</p>
        <p>Your existing PIN will be used to protect the keys.</p>
        <button class="btn btn-primary" onclick="XChatUI.registerKeys()">Generate & Register Keys</button>
      </div>
    `;
  }

  async function attemptUnlock() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">🔑 Unlocking encryption keys...</div>';
    try {
      const unlockRes = await fetch(`/integrations/${state.integrationId}/xchat/unlock?auth=${state.auth}`, { method: 'POST' });
      const unlockData = await unlockRes.json();
      if (unlockData.unlocked) {
        content.innerHTML = '<div class="loading">✅ Keys unlocked!</div>';
        await new Promise(r => setTimeout(r, 800));
        showTab('conversations');
      } else {
        content.innerHTML = `<div class="xchat-pin-section">
          <h3>⚠️ Unlock Failed</h3>
          <p>${unlockData.reason || 'Could not recover keys from Juicebox.'}</p>
          <button class="btn btn-secondary" onclick="XChatUI.resetPin()">Reset PIN</button>
          <button class="btn btn-primary" onclick="XChatUI.showTab('conversations')">Continue without decryption</button>
        </div>`;
      }
    } catch (e) {
      showTab('conversations');
    }
  }

  async function registerKeys() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">🔑 Generating keys and registering with X...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/register?auth=${state.auth}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      content.innerHTML = '<div class="loading">✅ Encryption keys registered!</div>';
      await new Promise(r => setTimeout(r, 1000));
      showTab('conversations');
    } catch (e) {
      content.innerHTML = `<div class="xchat-pin-section">
        <h3>❌ Registration Failed</h3>
        <p>${e.message}</p>
        <button class="btn btn-primary" onclick="XChatUI.checkPinAndShow()">Retry</button>
      </div>`;
    }
  }

  async function savePin() {
    const pin = document.getElementById('xchatPinInput').value.trim();
    if (!pin || !/^[0-9]{4}$/.test(pin)) { alert('PIN must be exactly 4 digits'); return; }
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Saving PIN...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save PIN');
      // Re-check state — will now detect needs_registration or attempt unlock
      await checkPinAndShow();
    } catch (e) {
      alert(`Failed to save PIN: ${e.message}`);
      renderPinPrompt(false);
    }
  }

  function close() {
    stopWebhookSSE();
    const modal = document.getElementById('xchatModal');
    if (modal) modal.style.display = 'none';
  }

  function showTab(tab) {
    stopWebhookSSE();
    state.currentConversation = null;
    document.querySelectorAll('.xchat-tab').forEach((el, i) => {
      el.classList.toggle('active', (i === 0 && tab === 'conversations') || (i === 1 && tab === 'keys') || (i === 2 && tab === 'xaa'));
    });
    if (tab === 'conversations') loadConversations();
    else if (tab === 'keys') loadKeyManagement();
    else if (tab === 'xaa') loadXAASubscriptions();
  }

  // --- Conversations ---

  async function loadConversations() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading conversations...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations?auth=${state.auth}`);
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : data.detail || JSON.stringify(data.error) || 'Failed to load');
      state.conversations = data.data || [];
      // Lookup all participant users
      const allIds = [...new Set(state.conversations.flatMap(c => c.participant_ids || c.member_ids || []))];
      await lookupUsers(allIds);
      renderConversations();
    } catch (e) {
      content.innerHTML = `<div class="loading">Error: ${e.message || JSON.stringify(e)}</div>`;
    }
  }

  function renderConversations() {
    const content = document.getElementById('xchatContent');
    if (state.conversations.length === 0) {
      content.innerHTML = `<div class="loading">No conversations found</div>
        <button class="btn btn-primary" onclick="XChatUI.showNewChat()">+ New Chat</button>`;
      return;
    }
    content.innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="XChatUI.showNewChat()" style="margin-bottom:10px">+ New Chat</button>
    ` + state.conversations.map(c => {
      const isGroup = c.type === 'group';
      const pIds = (c.participant_ids || c.member_ids || []).filter(id => id !== state.userId);
      const otherUser = !isGroup && pIds.length > 0 ? userCache[pIds[0]] : null;
      const label = isGroup ? (c.group_name || `Group ${c.id}`) : (otherUser ? `${otherUser.name} @${otherUser.username}` : `DM ${c.id}`);
      const avatar = otherUser?.profile_image_url ? `<img src="/media/proxy/public?url=${encodeURIComponent(otherUser.profile_image_url)}" class="xchat-conv-avatar" onerror="this.style.display='none'">` : '';
      const participants = (c.participant_ids || c.member_ids || []).map(id => {
        const u = userCache[id]; return u ? `@${u.username}` : id;
      }).join(', ');
      return `
        <div class="xchat-conversation-item" onclick="XChatUI.openConversation('${c.id}')">
          <div class="xchat-conv-icon">${avatar || (isGroup ? '👥' : '💬')}</div>
          <div class="xchat-conv-info">
            <div class="xchat-conv-name">${label}</div>
            <div class="xchat-conv-meta">${participants}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Messages ---

  async function lookupUsers(ids) {
    const uncached = ids.filter(id => !userCache[id]);
    if (uncached.length > 0 && state.appId) {
      try {
        const res = await fetch(`/credentials/${state.appId}/users?ids=${uncached.join(',')}`);
        if (res.ok) {
          const { data } = await res.json();
          Object.assign(userCache, data || {});
        }
      } catch {}
    }
  }

  function renderUser(senderId, isSelf) {
    if (isSelf) return '<span class="xchat-msg-sender">You</span>';
    const u = userCache[senderId];
    if (!u) return `<span class="xchat-msg-sender">${senderId}</span>`;
    const img = u.profile_image_url ? `<img src="/media/proxy/public?url=${encodeURIComponent(u.profile_image_url)}" class="xchat-avatar" onerror="this.style.display='none'">` : '';
    return `${img}<span class="xchat-msg-sender">${u.name} <span class="xchat-username">@${u.username}</span></span>`;
  }

  // --- Webhook SSE for live message updates ---
  let webhookSSE = null;

  function startWebhookSSE() {
    if (webhookSSE) webhookSSE.close();
    webhookSSE = new EventSource('/webhook-events/stream');
    webhookSSE.onmessage = async (e) => {
      try {
        const event = JSON.parse(e.data);
        const eventType = event.body?.data?.event_type;
        if (!eventType?.startsWith('chat.')) return;
        const payload = event.body?.data?.payload;
        if (!payload?.conversation_id || !state.currentConversation) return;
        // Normalize conversation IDs for comparison
        const normalize = id => id.replace(/-/g, ':');
        if (normalize(payload.conversation_id) !== normalize(state.currentConversation)) return;
        // Build message from decrypted webhook data
        const dec = event.decrypted;
        if (!dec) return;
        // Handle reactions — apply to target message
        if (dec.reaction) {
          const target = state.messages.find(m => m.id === dec.reaction.message_sequence_id);
          if (target) {
            if (!target.reactions) target.reactions = [];
            if (dec.reaction.action === 'add') {
              target.reactions.push({ emoji: dec.reaction.emoji, sender_id: payload.sender_id || dec.sender_id });
            } else {
              const sid = payload.sender_id || dec.sender_id;
              target.reactions = target.reactions.filter(r => !(r.emoji === dec.reaction.emoji && r.sender_id === sid));
            }
            renderMessages(undefined, { scrollToBottom: false });
          }
          return;
        }
        // Handle edits — apply to target message
        if (dec.edit) {
          const target = state.messages.find(m => m.id === dec.edit.message_sequence_id);
          if (target) {
            target.text = dec.edit.updated_text;
            target.entities = dec.edit.entities || null;
            target.edited = true;
            renderMessages(undefined, { scrollToBottom: false });
          }
          return;
        }
        const msg = {
          id: payload.id,
          sender_id: payload.sender_id || dec.sender_id,
          conversation_id: payload.conversation_id,
          created_at: payload.created_at_msec ? new Date(parseInt(payload.created_at_msec)).toISOString() : new Date().toISOString(),
          text: dec.text || null,
          entities: dec.entities || null,
          attachments: dec.attachments || null,
          reply_to: dec.reply_to || null,
          forwarded_message: dec.forwarded_message || null,
          ttl_msec: dec.ttl_msec || null,
          encrypted: false,
          source: 'webhook-live',
        };
        // Avoid duplicates (covers optimistic sends from UI)
        if (state.messages.find(m => m.id === msg.id)) return;
        // Lookup sender if needed
        if (msg.sender_id && !userCache[msg.sender_id]) await lookupUsers([msg.sender_id]);
        state.messages.push(msg);
        renderMessages();
      } catch {}
    };
  }

  function stopWebhookSSE() {
    if (webhookSSE) { webhookSSE.close(); webhookSSE = null; }
  }

  async function openConversation(conversationId) {
    state.currentConversation = conversationId;
    startWebhookSSE();
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading messages...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${conversationId}/messages?auth=${state.auth}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : data.detail || JSON.stringify(data.error) || `HTTP ${res.status}`);
      state.messages = data.data || [];
      state.messagesSource = data.meta?.source || 'unknown';
      state.nextToken = data.meta?.next_token || null;
      const senderIds = [...new Set(state.messages.map(m => m.sender_id).filter(Boolean))];
      await lookupUsers(senderIds);
      renderMessages();
    } catch (e) {
      state.messages = [];
      renderMessages(e.message || JSON.stringify(e));
    }
  }

  function renderMessages(errorMsg, { scrollToBottom = true } = {}) {
    const content = document.getElementById('xchatContent');
    // Save scroll position if preserving
    const oldList = document.querySelector('.xchat-messages-list');
    const savedScroll = !scrollToBottom && oldList ? oldList.scrollTop : null;
    const backBtn = `<button class="btn btn-secondary btn-sm" onclick="XChatUI.showTab('conversations')">← Back</button>`;
    const sourceLabel = state.messagesSource === 'api' ? '🔐 Messages fetched from X Chat API and decrypted locally' : '📨 Messages loaded from webhook events';
    const sourceNote = `<div class="xchat-enc-note">${sourceLabel}</div>`;

    const messagesHtml = errorMsg
      ? `<div class="xchat-error-msg">⚠️ Could not load messages: ${errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
      : state.messages.length === 0
      ? '<div class="loading">No messages yet. Send a message to start the conversation.</div>'
      : state.messages.map(m => {
          const isSelf = m.sender_id === state.userId;
          // Standalone reaction (parent not in page)
          if (m.reaction) {
            return `<div class="xchat-message xchat-msg-event">
              <span class="xchat-msg-time">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</span>
              ${renderUser(m.sender_id, isSelf)} ${m.reaction.action === 'add' ? 'reacted' : 'unreacted'} ${m.reaction.emoji}
            </div>`;
          }
          // Standalone edit (parent not in page)
          if (m.edit) {
            return `<div class="xchat-message xchat-msg-event">
              <span class="xchat-msg-time">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</span>
              ${renderUser(m.sender_id, isSelf)} edited a message: "${escapeHtml(m.edit.updated_text || '')}"
            </div>`;
          }
          // Group membership events
          if (m.group_event) {
            const ge = m.group_event;
            let desc = '';
            if (ge.type === 'member_add') desc = `added ${(ge.member_ids || []).map(id => userCache[id]?.name || id).join(', ')}`;
            else if (ge.type === 'member_remove') desc = `${(ge.member_ids || []).map(id => userCache[id]?.name || id).join(', ')} left`;
            else if (ge.type === 'title_change') desc = `changed group title to "${escapeHtml(ge.title || '')}"`;            else if (ge.type === 'group_create') desc = `created group with ${(ge.member_ids || []).map(id => userCache[id]?.name || id).join(', ')}`;
            else if (ge.type === 'key_change') desc = `encryption key rotated`;            const icon = ge.type === 'key_change' ? '🔑' : '👥';
            return `<div class="xchat-message xchat-msg-event xchat-group-event">
              <span class="xchat-msg-time">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</span>
              ${icon} ${desc}
            </div>`;
          }
          const replyHtml = m.reply_to ? `<div class="xchat-reply-preview"><span class="xchat-reply-sender">${m.reply_to.sender_display_name || m.reply_to.sender_id || ''}</span> ${escapeHtml(m.reply_to.message_text || '')}</div>` : '';
          const forwardedHtml = m.forwarded_message ? `<div class="xchat-forwarded-tag">↪️ Forwarded</div>` : '';
          const textHtml = m.text ? `<div>${renderTextWithEntities(m.text, m.entities)}</div>` : '';
          const attHtml = m.attachments?.length ? m.attachments.map(a => {
            if (a.type === 'url' && a.url) return `<div class="xchat-attachment">🔗 <a href="${a.url}" target="_blank">${a.display_url || a.url}</a></div>`;
            const sizeStr = a.filesize_bytes ? ` — ${(a.filesize_bytes/1024/1024).toFixed(1)}MB` : '';
            const dimStr = a.width ? ` (${a.width}×${a.height})` : '';
            const name = a.filename || a.media_hash_key || 'attachment';
            const downloadBtn = `<button class="xchat-download-btn" onclick="XChatUI.downloadMedia('${a.media_hash_key}', '${(a.filename || '').replace(/'/g, '')}')" title="Download">⬇️ Download</button>`;
            if (a.type === 'image' || a.type === 'gif') {
              return `<div class="xchat-attachment xchat-media-attachment">
                <img src="/integrations/${state.integrationId}/xchat/media/proxy?auth=${state.auth}&conversation_id=${encodeURIComponent(state.currentConversation)}&media_hash_key=${encodeURIComponent(a.media_hash_key)}" alt="${name}" class="xchat-media-inline" onerror="this.classList.add('xchat-media-broken');this.alt='⚠️ Image unavailable'">
                <div class="xchat-media-info">${name}${dimStr}${sizeStr} ${downloadBtn}</div>
              </div>`;
            }
            const isVideo = a.type === 'video' || /\.(mp4|mov|webm|m4v)$/i.test(a.filename || '');
            const isAudio = a.type === 'audio' || /\.(m4a|mp3|ogg|wav|aac)$/i.test(a.filename || '');
            if (isVideo) {
              const videoId = `vid-${a.media_hash_key}`;
              const mediaUrl = `/integrations/${state.integrationId}/xchat/media/proxy?auth=${state.auth}&conversation_id=${encodeURIComponent(state.currentConversation)}&media_hash_key=${encodeURIComponent(a.media_hash_key)}`;
              return `<div class="xchat-attachment xchat-media-attachment">
                <video id="${videoId}" src="${mediaUrl}" class="xchat-media-inline" controls preload="metadata" onloadeddata="XChatUI.enableSeek(this)" onerror="this.classList.add('xchat-media-broken');this.outerHTML='<div class=xchat-media-broken>⚠️ Video unavailable</div>'"></video>
                <div class="xchat-media-info">${name}${dimStr}${sizeStr} ${downloadBtn}</div>
              </div>`;
            }
            if (isAudio) {
              const mediaUrl = `/integrations/${state.integrationId}/xchat/media/proxy?auth=${state.auth}&conversation_id=${encodeURIComponent(state.currentConversation)}&media_hash_key=${encodeURIComponent(a.media_hash_key)}`;
              return `<div class="xchat-attachment xchat-audio-attachment">
                🎤 <audio src="${mediaUrl}" controls preload="metadata" onloadeddata="XChatUI.enableSeek(this)"></audio>
                <div class="xchat-media-info">${name}${sizeStr} ${downloadBtn}</div>
              </div>`;
            }
            return `<div class="xchat-attachment xchat-file-attachment">📎 <strong>${name}</strong> <span class="xchat-file-meta">${a.type || 'file'}${dimStr}${sizeStr}</span> ${downloadBtn}</div>`;
          }).join('') : '';
          // Reactions display
          const reactionsHtml = m.reactions?.length ? `<div class="xchat-reactions">${m.reactions.map(r => { const u = userCache[r.sender_id]; const name = u ? `@${u.username}` : r.sender_id; const isOwn = r.sender_id === state.userId; return `<span class="xchat-reaction${isOwn ? ' xchat-reaction-own' : ''}" title="${name}${isOwn ? ' (click to remove)' : ''}" onclick="XChatUI.sendReaction('${m.id}', '${r.emoji}', true)"><span class="xchat-reaction-emoji">${r.emoji}</span>${u?.profile_image_url ? `<img src="/media/proxy/public?url=${encodeURIComponent(u.profile_image_url)}" class="xchat-reaction-avatar" onerror="this.style.display='none'">` : ''}</span>`; }).join('')}</div>` : '';
          const editedTag = m.edited ? '<span class="xchat-edited">(edited)</span>' : '';
          const ttlTag = m.ttl_msec ? (() => {
            const expiresAt = new Date(new Date(m.created_at).getTime() + m.ttl_msec);
            const expired = Date.now() > expiresAt.getTime();
            const dur = m.ttl_msec >= 60000 ? `${Math.round(m.ttl_msec/60000)}m` : `${Math.round(m.ttl_msec/1000)}s`;
            return expired
              ? `<span class="xchat-ttl xchat-ttl-expired" title="Expired at ${expiresAt.toLocaleString()}">⏱️ ${dur} expired</span>`
              : `<span class="xchat-ttl" title="Disappears at ${expiresAt.toLocaleString()}">⏱️ ${dur}</span>`;
          })() : '';
          return `
            <div class="xchat-message ${isSelf ? 'xchat-msg-self' : ''}${m.ttl_msec && Date.now() > new Date(m.created_at).getTime() + m.ttl_msec ? ' xchat-msg-expired' : ''}" data-msg-id="${m.id}">
              <div class="xchat-msg-meta">
                ${renderUser(m.sender_id, isSelf)}
                <span class="xchat-msg-time">${m.created_at ? new Date(m.created_at).toLocaleString() : ''} ${editedTag} ${ttlTag}</span>
              </div>
              <div class="xchat-msg-body">
                ${forwardedHtml}
                ${replyHtml}
                ${textHtml}
                ${attHtml}
                ${reactionsHtml}
                ${m.encrypted ? '<div class="xchat-encrypted-payload">[encrypted — keys not available]</div>' : ''}
                ${!m.encrypted && m.id ? `<div class="xchat-msg-actions">
                  <button class="xchat-action-btn" onclick="XChatUI.showReactPicker('${m.id}')" title="React">😀</button>
                  <button class="xchat-action-btn" onclick="XChatUI.startReply('${m.id}')" title="Reply">↩️</button>
                  ${isSelf && m.text ? `<button class="xchat-action-btn" onclick="XChatUI.startEdit('${m.id}', this)" title="Edit">✏️</button>` : ''}
                </div>` : ''}
              </div>
            </div>
          `;
        }).join('');

    const loadMoreBtn = state.nextToken ? `<button class="btn btn-secondary btn-sm xchat-load-more" onclick="XChatUI.loadOlderMessages()">Load older messages...</button>` : '';

    content.innerHTML = `
      ${backBtn}
      ${sourceNote}
      ${loadMoreBtn}
      <div class="xchat-messages-list">${messagesHtml}</div>
      <div id="xchatReplyPreview" class="xchat-reply-preview-bar" style="display:none"></div>
      <div class="xchat-send-form">
        <input type="file" id="xchatFileInput" accept="image/*" style="display:none" onchange="XChatUI.onFileSelect(event)">
        <button class="btn btn-secondary" onclick="document.getElementById('xchatFileInput').click()">📎</button>
        <div id="xchatPendingMedia" class="pending-media" style="display:none"></div>
        <input type="text" id="xchatMsgInput" placeholder="Type an encrypted message..." oninput="XChatUI.onTypingInput()" onkeypress="if(event.key==='Enter')XChatUI.sendMessage()">
        <button class="btn btn-primary" onclick="XChatUI.sendMessage()">Send</button>
      </div>
    `;
    // Scroll handling
    const list = document.querySelector('.xchat-messages-list');
    if (list) {
      if (savedScroll !== null) list.scrollTop = savedScroll;
      else list.scrollTop = list.scrollHeight;
    }
  }

  // --- Send ---

  let pendingFile = null;
  let typingStartedAt = null;
  let lastTypingSentAt = 0;
  let typingTimeout = null;

  function onTypingInput() {
    const now = Date.now();
    if (!typingStartedAt) typingStartedAt = now;
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { typingStartedAt = null; }, 3000);
    if (now - typingStartedAt < 2000) return;
    if (now - lastTypingSentAt < 5000) return;
    lastTypingSentAt = now;
    fetch(`/integrations/${state.integrationId}/xchat/conversations/${state.currentConversation}/typing?auth=${state.auth}`, { method: 'POST' }).catch(() => {});
  }

  function onFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    pendingFile = file;
    const el = document.getElementById('xchatPendingMedia');
    el.innerHTML = `📎 ${file.name} <button onclick="XChatUI.clearFile()">✕</button>`;
    el.style.display = 'flex';
  }

  function clearFile() {
    pendingFile = null;
    document.getElementById('xchatFileInput').value = '';
    const el = document.getElementById('xchatPendingMedia');
    el.style.display = 'none';
    el.innerHTML = '';
  }

  async function sendMessage() {
    const input = document.getElementById('xchatMsgInput');
    const text = input.value.trim();
    if (!text && !pendingFile) return;

    try {
      let media_hash_key = null;

      if (pendingFile) {
        media_hash_key = await uploadMedia(pendingFile);
      }

      showUploadStatus('🔄 Sending...');
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${state.currentConversation}/send?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          media_hash_key,
          conversation_token: state.conversationToken,
          key_version: state.keyVersion,
          reply_to: state.replyTo || undefined,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');

      input.value = '';
      typingStartedAt = null;
      const replyTo = state.replyTo;
      cancelReply();
      clearFile();
      showUploadStatus('');
      document.getElementById('xchatPendingMedia').style.display = 'none';
      // Add sent message optimistically
      state.messages.push({
        id: data.data?.id || `local-${Date.now()}`,
        sender_id: state.userId,
        conversation_id: state.currentConversation,
        created_at: new Date().toISOString(),
        text: text || null,
        attachments: media_hash_key ? [{ media_hash_key, type: 'file' }] : null,
        reply_to: replyTo ? { sender_id: replyTo.sender_id, sender_display_name: replyTo.sender_display_name, message_text: replyTo.message_text } : null,
        encrypted: false,
        source: 'local',
      });
      renderMessages();
    } catch (e) {
      showUploadStatus(`❌ ${e.message}`);
    }
  }

  function showUploadStatus(text) {
    const el = document.getElementById('xchatPendingMedia');
    const isProgress = text.startsWith('🔄');
    el.innerHTML = isProgress
      ? `<span>${text}</span><div class="spinner"></div>`
      : `<span>${text}</span><button onclick="XChatUI.clearFile()">✕</button>`;
    el.style.display = 'flex';
  }

  // --- Media Upload ---

  async function uploadMedia(file) {
    const base64 = await fileToBase64(file);
    showUploadStatus(`🔄 Preparing ${file.name}...`);
    const res = await fetch(`/integrations/${state.integrationId}/xchat/media/upload?auth=${state.auth}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: base64.split(',')[1], conversation_id: state.currentConversation })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Upload failed');
    }

    const stepLabels = { init: 'Initializing...', append: 'Uploading', finalize: 'Finalizing...', complete: 'Ready' };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();
      for (const chunk of lines) {
        if (!chunk.startsWith('data: ')) continue;
        const data = JSON.parse(chunk.slice(6));
        if (data.error) throw new Error(data.error);
        if (data.step) {
          const label = stepLabels[data.step] || data.step;
          showUploadStatus(`🔄 ${data.detail ? `${label} — ${data.detail}` : label}`);
        }
        if (data.media_hash_key) result = data;
      }
    }

    if (!result?.media_hash_key) throw new Error('Upload failed: no media_hash_key');
    return result.media_hash_key;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // --- XAA Subscriptions ---

  async function loadXAASubscriptions() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading XAA subscriptions...</div>';
    let subscriptions = [];
    let subsError = null;
    let settings = null;
    try {
      const [subsRes, settingsRes] = await Promise.all([
        fetch(`/integrations/${state.integrationId}/xaa/subscriptions?auth=${state.auth}`),
        fetch(`/integrations/${state.integrationId}/xchat/settings`)
      ]);
      const settingsData = await settingsRes.json();
      settings = settingsData.xchat;
      const subsData = await subsRes.json();
      if (!subsRes.ok) subsError = subsData.error || 'Failed to load subscriptions';
      else subscriptions = subsData.data || [];
    } catch (e) {
      subsError = e.message;
    }
    renderXAASubscriptions(subscriptions, settings, subsError);
  }

  function renderXAASubscriptions(subscriptions, settings, subsError) {
    const content = document.getElementById('xchatContent');
    const subsList = subsError
      ? `<div class="loading">⚠️ ${subsError}</div>`
      : subscriptions.length === 0
      ? '<div class="loading">No active subscriptions</div>'
      : subscriptions.map(s => `
          <div class="xchat-subscription-item">
            <div class="xchat-sub-info">
              <strong>${s.event_type}</strong>
              <span>user: ${s.filter?.user_id || 'all'}</span>
              <span>webhook: ${s.webhook_id || 'stream'}</span>
              ${s.tag ? `<span class="badge">${s.tag}</span>` : ''}
            </div>
            <div class="xchat-sub-actions">
              <button class="btn btn-secondary btn-sm" onclick="XChatUI.editSubscription('${s.subscription_id}', '${s.webhook_id || ''}', '${s.tag || ''}')">Edit</button>
              <button class="btn btn-secondary btn-sm" onclick="XChatUI.deleteSubscription('${s.subscription_id}')">Delete</button>
            </div>
          </div>
        `).join('');

    content.innerHTML = `
      <div class="xchat-xaa-section">
        <h3>Key Status</h3>
        <div class="xchat-key-status">
          <span class="xchat-key-badge ${settings?.has_pin ? 'ok' : 'missing'}">${settings?.has_pin ? '✓ PIN set' : '✗ No PIN'}</span>
          <span class="xchat-key-badge ${settings?.has_private_key ? 'ok' : 'missing'}">${settings?.has_private_key ? '✓ Private key cached' : '✗ Private key not cached'}</span>
        </div>
        <div class="xchat-key-actions">
          <button class="btn btn-secondary btn-sm" onclick="XChatUI.resetPin()">🔑 Re-enter PIN</button>
          <button class="btn btn-secondary btn-sm" onclick="XChatUI.unlockKeys()">🔓 Unlock Keys</button>
          <button class="btn btn-secondary btn-sm" onclick="XChatUI.showChangePin()">🔄 Change PIN</button>
          <button class="btn btn-danger btn-sm" onclick="XChatUI.confirmReregister()" style="background:#dc3545;color:#fff">⚠️ New Identity</button>
        </div>
      </div>
      <div class="xchat-xaa-section">
        <h3>Active Subscriptions</h3>
        ${subsList}
      </div>
      <div class="xchat-xaa-section">
        <h3>Create Subscription</h3>
        <div class="xchat-xaa-form">
          <div class="xchat-event-types">
            <label><input type="checkbox" value="chat.received" class="xaaEventCheck" checked> chat.received</label>
            <label><input type="checkbox" value="chat.sent" class="xaaEventCheck" checked> chat.sent</label>
            <label><input type="checkbox" value="chat.conversation_join" class="xaaEventCheck" checked> chat.conversation_join</label>
            <label><input type="checkbox" value="dm.received" class="xaaEventCheck"> dm.received</label>
            <label><input type="checkbox" value="dm.sent" class="xaaEventCheck"> dm.sent</label>
            <label><input type="checkbox" value="dm.indicate_typing" class="xaaEventCheck"> dm.indicate_typing</label>
            <label><input type="checkbox" value="dm.read" class="xaaEventCheck"> dm.read</label>
            <label><input type="checkbox" value="follow.follow" class="xaaEventCheck"> follow.follow</label>
            <label><input type="checkbox" value="follow.unfollow" class="xaaEventCheck"> follow.unfollow</label>
            <label><input type="checkbox" value="profile.update.bio" class="xaaEventCheck"> profile.update.bio</label>
            <label><input type="checkbox" value="profile.update.profile_picture" class="xaaEventCheck"> profile.update.profile_picture</label>
            <label><input type="checkbox" value="profile.update.banner_picture" class="xaaEventCheck"> profile.update.banner_picture</label>
            <label><input type="checkbox" value="profile.update.screenname" class="xaaEventCheck"> profile.update.screenname</label>
            <label><input type="checkbox" value="profile.update.handle" class="xaaEventCheck"> profile.update.handle</label>
            <label><input type="checkbox" value="profile.update.geo" class="xaaEventCheck"> profile.update.geo</label>
            <label><input type="checkbox" value="profile.update.url" class="xaaEventCheck"> profile.update.url</label>
            <label><input type="checkbox" value="profile.update.verified_badge" class="xaaEventCheck"> profile.update.verified_badge</label>
            <label><input type="checkbox" value="profile.update.affiliate_badge" class="xaaEventCheck"> profile.update.affiliate_badge</label>
            <label><input type="checkbox" value="spaces.start" class="xaaEventCheck"> spaces.start</label>
            <label><input type="checkbox" value="spaces.end" class="xaaEventCheck"> spaces.end</label>
            <label><input type="checkbox" value="news.new" class="xaaEventCheck"> news.new</label>
          </div>
          <div class="xchat-xaa-form-inputs">
            <input type="text" id="xaaUserId" placeholder="User ID (filter)" value="${state.userId || ''}">
            <input type="text" id="xaaWebhookId" placeholder="Webhook ID (optional)">
            <input type="text" id="xaaTag" placeholder="Tag (optional)">
            <button class="btn btn-primary" onclick="XChatUI.createSubscription()">Subscribe</button>
          </div>
        </div>
      </div>
    `;
  }

  async function createSubscription() {
    const eventTypes = [...document.querySelectorAll('.xaaEventCheck:checked')].map(el => el.value);
    const user_id = document.getElementById('xaaUserId').value.trim();
    const webhook_id = document.getElementById('xaaWebhookId').value.trim();
    const tag = document.getElementById('xaaTag').value.trim();

    if (!user_id) { alert('User ID is required'); return; }
    if (eventTypes.length === 0) { alert('Select at least one event type'); return; }

    try {
      for (const event_type of eventTypes) {
        const body = { event_type, user_id };
        if (webhook_id) body.webhook_id = webhook_id;
        if (tag) body.tag = tag;

        const res = await fetch(`/integrations/${state.integrationId}/xaa/subscriptions?auth=${state.auth}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${event_type}: ${data.error || JSON.stringify(data)}`);
      }
      loadXAASubscriptions();
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  }

  async function deleteSubscription(subscriptionId) {
    if (!confirm('Delete this subscription?')) return;
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xaa/subscriptions/${subscriptionId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      loadXAASubscriptions();
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  }

  function editSubscription(subscriptionId, currentWebhookId, currentTag) {
    const content = document.getElementById('xchatContent');
    content.innerHTML = `
      <div class="xchat-xaa-section">
        <h3>Edit Subscription</h3>
        <p>ID: <code>${subscriptionId}</code></p>
        <div class="xchat-xaa-form">
          <div class="xchat-xaa-form-inputs">
            <input type="text" id="editWebhookId" placeholder="Webhook ID" value="${currentWebhookId}">
            <input type="text" id="editTag" placeholder="Tag" value="${currentTag}">
            <button class="btn btn-primary" onclick="XChatUI.updateSubscription('${subscriptionId}')">Save</button>
            <button class="btn btn-secondary" onclick="XChatUI.showTab('xaa')">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  async function updateSubscription(subscriptionId) {
    const webhook_id = document.getElementById('editWebhookId').value.trim();
    const tag = document.getElementById('editTag').value.trim();
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xaa/subscriptions/${subscriptionId}?auth=${state.auth}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: webhook_id || undefined, tag: tag || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      loadXAASubscriptions();
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  }

  function resetPin() {
    renderPinPrompt();
  }

  function showChangePin() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = `
      <div class="xchat-pin-section">
        <h3>Change Juicebox PIN</h3>
        <p class="hint">Enter a new 4-digit PIN to re-encrypt your keys on Juicebox.</p>
        <input id="xchatNewPinInput" type="password" maxlength="4" pattern="[0-9]*" inputmode="numeric" placeholder="New PIN">
        <button class="btn btn-primary" onclick="XChatUI.changePin()">Change PIN</button>
        <button class="btn btn-secondary" onclick="XChatUI.showTab('xaa')">Cancel</button>
      </div>
    `;
  }

  function confirmReregister() {
    if (!confirm('⚠️ WARNING: This will generate NEW encryption keys.\n\nYou will PERMANENTLY lose access to ALL previous encrypted conversations.\n\nAre you sure?')) return;
    if (!confirm('⚠️ FINAL CONFIRMATION\n\nThis action is IRREVERSIBLE. All old messages will become unreadable.\n\nType OK in the next prompt to proceed.')) return;
    const typed = prompt('Type RESET to confirm new identity generation:');
    if (typed !== 'RESET') { alert('Cancelled.'); return; }
    forceRegisterKeys();
  }

  async function forceRegisterKeys() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">🔑 Generating NEW keys and registering with X...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/register?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      content.innerHTML = '<div class="loading">✅ New identity registered! Old conversations are now unreadable.</div>';
      setTimeout(() => showTab('xaa'), 2000);
    } catch (e) {
      alert(`Failed: ${e.message}`);
      showTab('xaa');
    }
  }

  async function changePin() {
    const newPin = document.getElementById('xchatNewPinInput').value.trim();
    if (!newPin || !/^[0-9]{4}$/.test(newPin)) { alert('New PIN must be exactly 4 digits'); return; }
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Changing PIN on Juicebox...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/change-pin?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change PIN');
      content.innerHTML = '<div class="loading">✅ PIN changed successfully!</div>';
      setTimeout(() => showTab('settings'), 1500);
    } catch (e) {
      alert(`Failed to change PIN: ${e.message}`);
      showChangePin();
    }
  }

  async function showNewChat() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading followers...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/dm/followers?auth=${state.auth}`);
      const followers = await res.json();
      if (!res.ok) throw new Error(followers.error || 'Failed to load followers');

      const backBtn = `<button class="btn btn-secondary btn-sm" onclick="XChatUI.showTab('conversations')">← Back</button>`;
      const list = followers.length === 0
        ? '<div class="loading">No followers found</div>'
        : followers.map(f => `
            <div class="xchat-conversation-item" onclick="XChatUI.openConversation('${f.id}')">
              <div class="xchat-conv-icon">${f.profile_image_url ? `<img src="${f.profile_image_url}" style="width:32px;height:32px;border-radius:50%">` : '💬'}</div>
              <div class="xchat-conv-info">
                <div class="xchat-conv-name">${f.name}</div>
                <div class="xchat-conv-meta">@${f.username} · ${f.id}</div>
              </div>
            </div>
          `).join('');

      content.innerHTML = `${backBtn}<h3 style="margin:10px 0 5px">Start new chat with:</h3>${list}`;
    } catch (e) {
      content.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    }
  }

  async function unlockKeys() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">🔑 Fetching public keys and attempting unlock...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/unlock?auth=${state.auth}&force=1`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unlock failed');
      if (data.unlocked) {
        content.innerHTML = '<div class="loading">✅ Keys unlocked successfully!</div>';
      } else {
        content.innerHTML = `<div class="loading">⚠️ Unlock failed: ${data.reason || 'Unknown'}</div>`;
      }
      await new Promise(r => setTimeout(r, 2000));
      showTab('conversations');
    } catch (e) {
      content.innerHTML = `<div class="loading">❌ ${e.message}</div>`;
    }
  }

  // --- Key Management ---

  async function loadKeyManagement() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading key versions...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/settings?auth=${state.auth}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      renderKeyManagement(data.xchat);
    } catch (e) {
      content.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    }
  }

  function renderKeyManagement(xchat) {
    const content = document.getElementById('xchatContent');
    const versions = xchat?.key_versions || [];

    const versionsList = versions.length === 0
      ? '<div class="loading">No key versions found on server</div>'
      : versions.map(k => {
          const date = new Date(parseInt(k.version)).toLocaleString();
          const statusClass = k.unlocked ? 'xchat-key-unlocked' : 'xchat-key-locked';
          const statusIcon = k.unlocked ? '🔓' : '🔒';
          const statusText = k.unlocked ? 'Unlocked' : 'Locked';
          const actions = k.unlocked
            ? `<button class="btn btn-secondary btn-sm" onclick="XChatUI.showChangePinForVersion('${k.version}')">Change PIN</button>`
            : `<button class="btn btn-primary btn-sm" onclick="XChatUI.showUnlockVersion('${k.version}')">Unlock</button>`;
          return `
            <div class="xchat-key-item ${statusClass}">
              <div class="xchat-key-info">
                <span class="xchat-key-version-label">${statusIcon} v${k.version}</span>
                <span class="xchat-key-date">${date}</span>
                <span class="xchat-key-status-badge ${k.unlocked ? 'ok' : 'missing'}">${statusText}</span>
              </div>
              <div class="xchat-key-actions">${actions}</div>
            </div>
          `;
        }).join('');

    content.innerHTML = `
      <div class="xchat-key-mgmt">
        <h3>🔑 Key Versions</h3>
        <p class="hint">Each version has its own PIN on Juicebox. Unlock individually if they use different PINs.</p>
        <div class="xchat-key-list">${versionsList}</div>
        <div class="xchat-key-bulk-actions">
          <button class="btn btn-secondary btn-sm" onclick="XChatUI.unlockKeys()">🔓 Unlock All (default PIN)</button>
          <button class="btn btn-secondary btn-sm" onclick="XChatUI.resetPin()">🔑 Re-enter Default PIN</button>
          <button class="btn btn-danger btn-sm" onclick="XChatUI.confirmReregister()" style="background:#dc3545;color:#fff">⚠️ New Identity</button>
        </div>
      </div>
    `;
  }

  function showUnlockVersion(version) {
    const content = document.getElementById('xchatContent');
    const date = new Date(parseInt(version)).toLocaleString();
    content.innerHTML = `
      <div class="xchat-pin-section">
        <h3>🔓 Unlock Key v${version}</h3>
        <p>Created: ${date}</p>
        <p>Enter the 4-digit PIN for this key version:</p>
        <div class="xchat-pin-form">
          <input type="password" id="xchatVersionPinInput" placeholder="••••" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" autocomplete="off">
          <button class="btn btn-primary" onclick="XChatUI.unlockVersion('${version}')">Unlock</button>
          <button class="btn btn-secondary" onclick="XChatUI.showTab('keys')">Cancel</button>
        </div>
      </div>
    `;
    setTimeout(() => {
      const input = document.getElementById('xchatVersionPinInput');
      if (input) { input.focus(); input.addEventListener('keypress', e => { if (e.key === 'Enter') XChatUI.unlockVersion(version); }); }
    }, 50);
  }

  async function unlockVersion(version) {
    const pin = document.getElementById('xchatVersionPinInput')?.value.trim();
    if (!pin || !/^[0-9]{4}$/.test(pin)) { alert('PIN must be exactly 4 digits'); return; }
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">🔑 Recovering key from Juicebox...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/unlock/${version}?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (data.unlocked) {
        content.innerHTML = `<div class="loading">✅ Key v${version} unlocked!</div>`;
        await new Promise(r => setTimeout(r, 1000));
      } else {
        content.innerHTML = `<div class="loading">⚠️ Failed: ${data.reason || 'Wrong PIN?'}</div>`;
        await new Promise(r => setTimeout(r, 2000));
      }
      showTab('keys');
    } catch (e) {
      content.innerHTML = `<div class="loading">❌ ${e.message}</div>`;
      await new Promise(r => setTimeout(r, 2000));
      showTab('keys');
    }
  }

  function showChangePinForVersion(version) {
    const content = document.getElementById('xchatContent');
    const date = new Date(parseInt(version)).toLocaleString();
    content.innerHTML = `
      <div class="xchat-pin-section">
        <h3>🔄 Change PIN for Key v${version}</h3>
        <p>Created: ${date}</p>
        <p>Enter a new 4-digit PIN for this key version:</p>
        <div class="xchat-pin-form">
          <input type="password" id="xchatNewVersionPinInput" placeholder="New PIN" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" autocomplete="off">
          <button class="btn btn-primary" onclick="XChatUI.changePinForVersion('${version}')">Change</button>
          <button class="btn btn-secondary" onclick="XChatUI.showTab('keys')">Cancel</button>
        </div>
      </div>
    `;
    setTimeout(() => {
      const input = document.getElementById('xchatNewVersionPinInput');
      if (input) { input.focus(); input.addEventListener('keypress', e => { if (e.key === 'Enter') XChatUI.changePinForVersion(version); }); }
    }, 50);
  }

  async function changePinForVersion(version) {
    const newPin = document.getElementById('xchatNewVersionPinInput')?.value.trim();
    if (!newPin || !/^[0-9]{4}$/.test(newPin)) { alert('PIN must be exactly 4 digits'); return; }
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">🔄 Changing PIN on Juicebox...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/change-pin/${version}?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      content.innerHTML = `<div class="loading">✅ PIN changed for v${version}!</div>`;
      await new Promise(r => setTimeout(r, 1000));
      showTab('keys');
    } catch (e) {
      content.innerHTML = `<div class="loading">❌ ${e.message}</div>`;
      await new Promise(r => setTimeout(r, 2000));
      showTab('keys');
    }
  }

  function renderTextWithEntities(text, entities) {
    if (!entities || entities.length === 0) return escapeHtml(text);
    // Sort entities by start_index descending so we can insert HTML without shifting indices
    const sorted = [...entities].sort((a, b) => b.start_index - a.start_index);
    let result = text;
    for (const e of sorted) {
      const slice = text.slice(e.start_index, e.end_index);
      let replacement;
      if (e.type === 'hashtag') replacement = `<span class="xchat-entity-hashtag">${escapeHtml(slice)}</span>`;
      else if (e.type === 'mention') replacement = `<span class="xchat-entity-mention">${escapeHtml(slice)}</span>`;
      else if (e.type === 'cashtag') replacement = `<span class="xchat-entity-cashtag">${escapeHtml(slice)}</span>`;
      else if (e.type === 'url') replacement = `<a href="${escapeHtml(slice)}" target="_blank">${escapeHtml(slice)}</a>`;
      else replacement = `<span class="xchat-entity">${escapeHtml(slice)}</span>`;
      result = result.slice(0, e.start_index) + replacement + result.slice(e.end_index);
    }
    // Escape the non-entity parts (already done via slice replacement)
    return result;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function loadOlderMessages() {
    if (!state.nextToken || !state.currentConversation) return;
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${state.currentConversation}/messages?auth=${state.auth}&pagination_token=${encodeURIComponent(state.nextToken)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const older = data.data || [];
      state.messages = [...older, ...state.messages];
      state.nextToken = data.meta?.next_token || null;
      const senderIds = [...new Set(older.map(m => m.sender_id).filter(Boolean))];
      await lookupUsers(senderIds);
      renderMessages(undefined, { scrollToBottom: false });
    } catch {}
  }

  function startReply(messageId) {
    const msg = state.messages.find(m => m.id === messageId);
    if (!msg) return;
    state.replyTo = {
      message_sequence_id: messageId,
      message_text: msg.text || '',
      sender_id: msg.sender_id,
      sender_display_name: userCache[msg.sender_id]?.name || msg.sender_id,
    };
    // Show reply preview above the input
    const preview = document.getElementById('xchatReplyPreview');
    if (preview) {
      preview.innerHTML = `<span class="xchat-reply-indicator">↩️ Replying to <strong>${escapeHtml(state.replyTo.sender_display_name)}</strong>: ${escapeHtml(state.replyTo.message_text.slice(0, 60))}${state.replyTo.message_text.length > 60 ? '...' : ''}</span> <button class="xchat-action-btn" onclick="XChatUI.cancelReply()">✕</button>`;
      preview.style.display = 'flex';
    }
    document.getElementById('xchatMsgInput')?.focus();
  }

  function cancelReply() {
    state.replyTo = null;
    const preview = document.getElementById('xchatReplyPreview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
  }

  function showReactPicker(messageId) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👎'];
    const existing = document.getElementById('xchat-react-picker');
    if (existing) existing.remove();
    const picker = document.createElement('div');
    picker.id = 'xchat-react-picker';
    picker.className = 'xchat-react-picker';
    picker.innerHTML = emojis.map(e => `<button class="xchat-emoji-btn" onclick="event.stopPropagation(); XChatUI.sendReaction('${messageId}', '${e}')">${e}</button>`).join('');
    // Attach to the message's actions area
    const btn = document.querySelector(`[data-msg-id="${messageId}"] .xchat-msg-actions`);
    if (btn) { btn.style.position = 'relative'; btn.appendChild(picker); }
    setTimeout(() => {
      const dismiss = (e) => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', dismiss); } };
      document.addEventListener('click', dismiss);
    }, 10);
  }

  async function sendReaction(messageId, emoji, remove) {
    const picker = document.getElementById('xchat-react-picker');
    if (picker) picker.remove();
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${state.currentConversation}/react?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_sequence_id: messageId, emoji, remove: !!remove }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      // Update local state without refetching
      const msg = state.messages.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = [];
        if (remove) {
          msg.reactions = msg.reactions.filter(r => !(r.emoji === emoji && r.sender_id === state.userId));
        } else {
          msg.reactions.push({ emoji, sender_id: state.userId });
        }
        renderMessages(undefined, { scrollToBottom: false });
      }
    } catch (e) {
      alert(`Reaction failed: ${e.message}`);
    }
  }

  function startEdit(messageId, btnEl) {
    const msg = state.messages.find(m => m.id === messageId);
    if (!msg?.text) return;
    const msgBody = btnEl.closest('.xchat-message').querySelector('.xchat-msg-body');
    msgBody.innerHTML = `
      <div class="xchat-edit-form">
        <input type="text" id="xchatEditInput" value="${escapeHtml(msg.text)}" onkeypress="if(event.key==='Enter')XChatUI.submitEdit('${messageId}')">
        <button class="btn btn-primary btn-sm" onclick="XChatUI.submitEdit('${messageId}')">Save</button>
        <button class="btn btn-secondary btn-sm" onclick="XChatUI.openConversation('${state.currentConversation}')">Cancel</button>
      </div>
    `;
    document.getElementById('xchatEditInput')?.focus();
  }

  async function submitEdit(messageId) {
    const input = document.getElementById('xchatEditInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${state.currentConversation}/edit?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_sequence_id: messageId, text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      // Update local state without refetching
      const msg = state.messages.find(m => m.id === messageId);
      if (msg) {
        msg.text = text;
        msg.edited = true;
      }
      renderMessages(undefined, { scrollToBottom: false });
    } catch (e) {
      alert(`Edit failed: ${e.message}`);
    }
  }

  function enableSeek(el) {
    // If Accept-Ranges is already present, seeking works — nothing to do
    if (el.dataset.seekEnabled) return;
    el.dataset.seekEnabled = '1';
    // After initial stream load, reload src to get Range-capable response from cache
    const currentTime = el.currentTime;
    const wasPlaying = !el.paused;
    const src = el.src;
    // Small delay to ensure cache write is flushed
    setTimeout(() => {
      el.src = '';
      el.src = src;
      el.addEventListener('loadeddata', () => {
        el.currentTime = currentTime;
        if (wasPlaying) el.play();
      }, { once: true });
    }, 500);
  }

  async function downloadMedia(mediaHashKey, filename) {
    if (!state.integrationId || !state.currentConversation) return;
    const url = `/integrations/${state.integrationId}/xchat/media/proxy?auth=${state.auth}&conversation_id=${encodeURIComponent(state.currentConversation)}&media_hash_key=${encodeURIComponent(mediaHashKey)}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `${resp.status} ${resp.statusText}` }));
        alert(`Download failed: ${err.error || resp.statusText}`);
        return;
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || mediaHashKey;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    }
  }

  return { open, close, showTab, openConversation, sendMessage, onFileSelect, clearFile, uploadMedia, createSubscription, deleteSubscription, editSubscription, updateSubscription, loadConversations, savePin, resetPin, unlockKeys, showNewChat, downloadMedia, loadOlderMessages, registerKeys, checkPinAndShow, showReactPicker, sendReaction, startEdit, submitEdit, startReply, cancelReply, showChangePin, changePin, confirmReregister, loadKeyManagement, showUnlockVersion, unlockVersion, showChangePinForVersion, changePinForVersion, onTypingInput, enableSeek };
})();
