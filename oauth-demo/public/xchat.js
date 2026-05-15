window.XChatUI = (() => {
  let state = { integrationId: null, auth: 'oauth2', conversations: [], currentConversation: null, messages: [] };

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
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save PIN');
      // Keep PIN in state — needed for the encryption path when chat-xdk becomes available
      state.pin = pin;
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
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      state.conversations = data.data || [];
      renderConversations();
    } catch (e) {
      content.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    }
  }

  function renderConversations() {
    const content = document.getElementById('xchatContent');
    if (state.conversations.length === 0) {
      content.innerHTML = '<div class="loading">No conversations found</div>';
      return;
    }
    content.innerHTML = state.conversations.map(c => {
      const isGroup = c.type === 'group';
      const label = isGroup ? (c.group_name || `Group ${c.id}`) : `DM ${c.id}`;
      const participants = (c.participant_ids || c.member_ids || []).join(', ');
      return `
        <div class="xchat-conversation-item" onclick="XChatUI.openConversation('${c.id}')">
          <div class="xchat-conv-icon">${isGroup ? '👥' : '💬'}</div>
          <div class="xchat-conv-info">
            <div class="xchat-conv-name">${label}</div>
            <div class="xchat-conv-meta">${participants}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Messages ---

  async function openConversation(conversationId) {
    state.currentConversation = conversationId;
    const content = document.getElementById('xchatContent');
    content.innerHTML = '<div class="loading">Loading messages...</div>';
    try {
      const res = await fetch(`/integrations/${state.integrationId}/xchat/conversations/${conversationId}/messages?auth=${state.auth}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      state.messages = data.data || [];
      renderMessages();
    } catch (e) {
      content.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    }
  }

  function renderMessages() {
    const content = document.getElementById('xchatContent');
    const backBtn = `<button class="btn btn-secondary btn-sm" onclick="XChatUI.showTab('conversations')">← Back</button>`;
    const encNote = `<div class="xchat-enc-note">⚠️ Messages are end-to-end encrypted. Decryption requires the chat-xdk (not available in TypeScript).</div>`;

    const messagesHtml = state.messages.length === 0
      ? '<div class="loading">No messages</div>'
      : state.messages.map(m => {
          const hasMedia = m.attachments?.length > 0 || m.encoded_message_create_event;
          return `
            <div class="xchat-message">
              <div class="xchat-msg-meta">
                <span class="xchat-msg-sender">${m.sender_id || 'unknown'}</span>
                <span class="xchat-msg-time">${m.created_at ? new Date(m.created_at).toLocaleString() : ''}</span>
              </div>
              <div class="xchat-msg-body">
                ${m.text ? `<div>${m.text}</div>` : ''}
                ${m.encoded_message_create_event ? `<div class="xchat-encrypted-payload">[encrypted] ${m.encoded_message_create_event.slice(0, 60)}...</div>` : ''}
                ${hasMedia ? '<span class="xchat-media-badge">📎 media attached</span>' : ''}
              </div>
            </div>
          `;
        }).join('');

    content.innerHTML = `
      ${backBtn}
      ${encNote}
      <div class="xchat-messages-list">${messagesHtml}</div>
      <div class="xchat-send-form">
        <input type="file" id="xchatFileInput" accept="image/*" style="display:none" onchange="XChatUI.onFileSelect(event)">
        <button class="btn btn-secondary" onclick="document.getElementById('xchatFileInput').click()">📎</button>
        <div id="xchatPendingMedia" class="pending-media" style="display:none"></div>
        <input type="text" id="xchatMsgInput" placeholder="Type a message (will be sent as base64-encoded plaintext)..." onkeypress="if(event.key==='Enter')XChatUI.sendMessage()">
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
            <button class="btn btn-secondary btn-sm" onclick="XChatUI.deleteSubscription('${s.subscription_id}')">Delete</button>
          </div>
        `).join('');

    content.innerHTML = `
      <div class="xchat-xaa-section">
        <h3>Key Status</h3>
        <div class="xchat-key-status">
          <span class="xchat-key-badge ${settings?.has_pin ? 'ok' : 'missing'}">${settings?.has_pin ? '✓ PIN set' : '✗ No PIN'}</span>
          <span class="xchat-key-badge ${settings?.has_private_key ? 'ok' : 'missing'}">${settings?.has_private_key ? '✓ Private key cached' : '✗ Private key not cached'}</span>
          <span class="xchat-key-badge ${settings?.conversation_key_count > 0 ? 'ok' : 'missing'}">${settings?.conversation_key_count || 0} conversation key(s) cached</span>
        </div>
      </div>
      <div class="xchat-xaa-section">
        <h3>Active Subscriptions</h3>
        ${subsList}
      </div>
      <div class="xchat-xaa-section">
        <h3>Create Subscription</h3>
        <div class="xchat-xaa-form">
          <select id="xaaEventType">
            <option value="chat.received">chat.received</option>
            <option value="chat.sent">chat.sent</option>
            <option value="chat.conversation_join">chat.conversation_join</option>
          </select>
          <input type="text" id="xaaUserId" placeholder="User ID (filter)">
          <input type="text" id="xaaWebhookId" placeholder="Webhook ID (optional)">
          <input type="text" id="xaaTag" placeholder="Tag (optional)">
          <button class="btn btn-primary" onclick="XChatUI.createSubscription()">Subscribe</button>
        </div>
      </div>
    `;
  }

  async function createSubscription() {
    const event_type = document.getElementById('xaaEventType').value;
    const user_id = document.getElementById('xaaUserId').value.trim();
    const webhook_id = document.getElementById('xaaWebhookId').value.trim();
    const tag = document.getElementById('xaaTag').value.trim();

    if (!user_id) { alert('User ID is required'); return; }

    try {
      const body = { event_type, user_id };
      if (webhook_id) body.webhook_id = webhook_id;
      if (tag) body.tag = tag;

      const res = await fetch(`/integrations/${state.integrationId}/xaa/subscriptions?auth=${state.auth}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || JSON.stringify(data));
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

  return { open, close, showTab, openConversation, sendMessage, onFileSelect, clearFile, uploadMedia, createSubscription, deleteSubscription, loadConversations, savePin };
})();
