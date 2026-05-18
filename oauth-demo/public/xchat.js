window.XChatUI = (() => {
  let state = { integrationId: null, appId: null, auth: 'oauth2', conversations: [], currentConversation: null, messages: [], userId: null };
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
      const res = await fetch(`/integrations/${state.integrationId}/xchat/settings`);
      const data = await res.json();
      if (data.xchat?.user_id) state.userId = data.xchat.user_id;
      if (data.xchat?.has_pin) {
        showTab('conversations');
      } else {
        renderPinPrompt();
      }
    } catch (e) {
      renderPinPrompt();
    }
  }

  function renderPinPrompt() {
    const content = document.getElementById('xchatContent');
    content.innerHTML = `
      <div class="xchat-pin-section">
        <h3>🔐 X Chat PIN Required</h3>
        <p>Enter the 4-digit numeric PIN you set up in the X app's Chat settings (Settings → Privacy → Direct Messages → Set passcode).</p>
        <p>Without it, you will not be able to access your messages.</p>
        <div class="xchat-pin-form">
          <input type="password" id="xchatPinInput" placeholder="••••" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" autocomplete="off">
          <button class="btn btn-primary" onclick="XChatUI.savePin()">Save PIN</button>
        </div>
        <p class="hint">Your PIN is stored securely on this server. Treat it like a password.</p>
      </div>
    `;
    // Auto-focus and submit on 4 digits
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

  async function savePin() {
    const pin = document.getElementById('xchatPinInput').value.trim();
    if (!pin) { alert('PIN is required'); return; }
    const content = document.getElementById('xchatContent');
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save PIN');
      state.pin = pin;

      // Attempt key unlock (best-effort — Juicebox not available in TS)
      content.innerHTML = '<div class="loading">🔑 Fetching public keys and attempting unlock...</div>';
      try {
        const unlockRes = await fetch(`/integrations/${state.integrationId}/xchat/unlock?auth=${state.auth}`, { method: 'POST' });
        const unlockData = await unlockRes.json();
        if (unlockData.unlocked) {
          content.innerHTML = '<div class="loading">✅ Keys unlocked successfully!</div>';
        } else {
          content.innerHTML = `<div class="loading">⚠️ Key unlock unavailable (${unlockData.reason || 'Juicebox requires Rust/Python XDK'}). Continuing without decryption.</div>`;
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (unlockErr) {
        // Non-fatal — proceed to conversations
      }

      showTab('conversations');
    } catch (e) {
      alert(`Failed to save PIN: ${e.message}`);
    }
  }

  function close() {
    const modal = document.getElementById('xchatModal');
    if (modal) modal.style.display = 'none';
  }

  function showTab(tab) {
    document.querySelectorAll('.xchat-tab').forEach((el, i) => {
      el.classList.toggle('active', (i === 0 && tab === 'conversations') || (i === 1 && tab === 'xaa'));
    });
    if (tab === 'conversations') loadConversations();
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

  async function openConversation(conversationId) {
    state.currentConversation = conversationId;
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading messages...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${conversationId}/messages?auth=${state.auth}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : data.detail || JSON.stringify(data.error) || `HTTP ${res.status}`);
      state.messages = data.data || [];
      state.messagesSource = data.meta?.source || 'unknown';
      const senderIds = [...new Set(state.messages.map(m => m.sender_id).filter(Boolean))];
      await lookupUsers(senderIds);
      renderMessages();
    } catch (e) {
      state.messages = [];
      renderMessages(e.message || JSON.stringify(e));
    }
  }

  function renderMessages(errorMsg) {
    const content = document.getElementById('xchatContent');
    const backBtn = `<button class="btn btn-secondary btn-sm" onclick="XChatUI.showTab('conversations')">← Back</button>`;
    const sourceNote = `<div class="xchat-enc-note">📨 Messages loaded from <strong>webhook events</strong> (XAA). No REST API exists for X Chat message history.</div>`;

    const messagesHtml = errorMsg
      ? `<div class="xchat-error-msg">⚠️ Could not load messages: ${errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
      : state.messages.length === 0
      ? '<div class="loading">No messages yet. Messages will appear here when received via webhook.</div>'
      : state.messages.map(m => {
          const isSelf = m.sender_id === state.userId;
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
            if (a.type === 'video') {
              return `<div class="xchat-attachment xchat-media-attachment">
                <video src="/integrations/${state.integrationId}/xchat/media/proxy?auth=${state.auth}&conversation_id=${encodeURIComponent(state.currentConversation)}&media_hash_key=${encodeURIComponent(a.media_hash_key)}" class="xchat-media-inline" controls onerror="this.classList.add('xchat-media-broken');this.outerHTML='<div class=xchat-media-broken>⚠️ Video unavailable</div>'"></video>
                <div class="xchat-media-info">${name}${dimStr}${sizeStr} ${downloadBtn}</div>
              </div>`;
            }
            return `<div class="xchat-attachment xchat-file-attachment">📎 <strong>${name}</strong> <span class="xchat-file-meta">${a.type || 'file'}${dimStr}${sizeStr}</span> ${downloadBtn}</div>`;
          }).join('') : '';
          return `
            <div class="xchat-message ${isSelf ? 'xchat-msg-self' : ''}">
              <div class="xchat-msg-meta">
                ${renderUser(m.sender_id, isSelf)}
                <span class="xchat-msg-time">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</span>
              </div>
              <div class="xchat-msg-body">
                ${textHtml}
                ${attHtml}
                ${m.encrypted ? '<div class="xchat-encrypted-payload">[encrypted — decryption pending]</div>' : ''}
              </div>
            </div>
          `;
        }).join('');

    content.innerHTML = `
      ${backBtn}
      ${sourceNote}
      <div class="xchat-messages-list">${messagesHtml}</div>
      <div class="xchat-send-form">
        <input type="file" id="xchatFileInput" accept="image/*" style="display:none" onchange="XChatUI.onFileSelect(event)">
        <button class="btn btn-secondary" onclick="document.getElementById('xchatFileInput').click()">📎</button>
        <div id="xchatPendingMedia" class="pending-media" style="display:none"></div>
        <input type="text" id="xchatMsgInput" placeholder="Type an encrypted message..." onkeypress="if(event.key==='Enter')XChatUI.sendMessage()">
        <button class="btn btn-primary" onclick="XChatUI.sendMessage()">Send</button>
      </div>
    `;
  }

  // --- Send ---

  let pendingFile = null;

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
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');

      input.value = '';
      clearFile();
      openConversation(state.currentConversation);
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
    try {
      const [subsRes, settingsRes] = await Promise.all([
        fetch(`/integrations/${state.integrationId}/xaa/subscriptions?auth=${state.auth}`),
        fetch(`/integrations/${state.integrationId}/xchat/settings`)
      ]);
      const subsData = await subsRes.json();
      const settingsData = await settingsRes.json();
      if (!subsRes.ok) throw new Error(subsData.error || 'Failed to load');
      renderXAASubscriptions(subsData.data || [], settingsData.xchat);
    } catch (e) {
      content.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    }
  }

  function renderXAASubscriptions(subscriptions, settings) {
    const content = document.getElementById('xchatContent');
    const subsList = subscriptions.length === 0
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
      const res = await fetch(`/integrations/${state.integrationId}/xchat/unlock?auth=${state.auth}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unlock failed');
      if (data.unlocked) {
        content.innerHTML = '<div class="loading">✅ Keys unlocked successfully!</div>';
      } else {
        content.innerHTML = `<div class="loading">⚠️ Unlock failed: ${data.reason || 'Unknown'}</div>`;
      }
      await new Promise(r => setTimeout(r, 2000));
      showTab('xaa');
    } catch (e) {
      content.innerHTML = `<div class="loading">❌ ${e.message}</div>`;
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

  return { open, close, showTab, openConversation, sendMessage, onFileSelect, clearFile, uploadMedia, createSubscription, deleteSubscription, editSubscription, updateSubscription, loadConversations, savePin, resetPin, unlockKeys, showNewChat, downloadMedia };
})();
