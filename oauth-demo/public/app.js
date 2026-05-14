class TwitterOAuthDemo {
    constructor() {
        this.integrations = [];
        this.credentials = [];
    }

    async init() {
        this.setupEventListeners();
        await this.loadCredentials();
        await this.loadIntegrations();
    }

    setupEventListeners() {
        document.getElementById('addCredentialsBtn').addEventListener('click', () => {
            this.showAddCredentialsModal();
        });

        document.getElementById('addIntegrationBtn').addEventListener('click', () => {
            this.showAddIntegrationModal();
        });

        document.getElementById('webhookMgmtBtn').addEventListener('click', () => {
            this.showWebhookModal();
        });

        document.getElementById('webhookEventsBtn').addEventListener('click', () => {
            this.showWebhookEventsModal();
        });

        // Modal close buttons
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', () => {
                this.hideAllModals();
            });
        });

        // Modal form submits
        document.getElementById('addCredentialsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createCredentials();
        });

        document.getElementById('addIntegrationForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.createIntegration();
        });

        // Close modals on outside click
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideAllModals();
            }
        });
    }

    async loadCredentials() {
        try {
            const response = await fetch('/credentials');
            this.credentials = await response.json();
        } catch (error) {
            console.error('Failed to load credentials:', error);
        }
    }

    async loadIntegrations() {
        try {
            const response = await fetch('/integrations');
            this.integrations = await response.json();
            this.renderIntegrations();
        } catch (error) {
            console.error('Failed to load integrations:', error);
        }
    }

    renderIntegrations() {
        const container = document.getElementById('integrationsList');
        container.innerHTML = '';

        this.integrations.forEach(integration => {
            const card = this.createIntegrationCard(integration);
            container.appendChild(card);
        });
    }

    createIntegrationCard(integration) {
        const card = document.createElement('div');
        card.className = 'integration-card';

        const oauth1User = integration.oauth1?.user;
        const oauth2User = integration.oauth2?.user;
        const app = this.credentials.find(c => c.appId === integration.appId);
        
        // Check if both users exist and are different
        const bothUsersExist = oauth1User && oauth2User;
        const usersDiffer = bothUsersExist && oauth1User.id !== oauth2User.id;
        
        let headerContent;
        if (usersDiffer) {
            // Show both users when they're different
            headerContent = `
                <div class="dual-users">
                    <div class="user-section">
                        <img src="${oauth1User.pictureUrl || ''}" alt="${oauth1User.name}" class="user-avatar small" 
                             onerror="this.style.display='none'">
                        <div class="user-info">
                            <h4>${oauth1User.name}</h4>
                            <p>@${oauth1User.username} (OAuth1)</p>
                        </div>
                    </div>
                    <div class="user-section">
                        <img src="${oauth2User.pictureUrl || ''}" alt="${oauth2User.name}" class="user-avatar small" 
                             onerror="this.style.display='none'">
                        <div class="user-info">
                            <h4>${oauth2User.name}</h4>
                            <p>@${oauth2User.username} (OAuth2)</p>
                        </div>
                    </div>
                </div>
            `;
        } else if (oauth1User || oauth2User) {
            // Show single user when only one exists or they're the same
            const user = oauth1User || oauth2User;
            headerContent = `
                <img src="${user.pictureUrl || ''}" alt="${user.name}" class="user-avatar" 
                     onerror="this.style.display='none'">
                <div class="user-info">
                    <h3>${user.name}</h3>
                    <p>@${user.username}</p>
                </div>
            `;
        } else {
            // No users connected
            headerContent = `
                <div class="user-avatar"></div>
                <div class="user-info">
                    <h3>${integration.name}</h3>
                    <p>Not connected</p>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="integration-header">
                ${headerContent}
            </div>
            
            <div class="integration-details">
                <div class="integration-title">
                    <div>
                        <p><strong>Name:</strong> ${integration.name}</p>
                        <p><strong>App:</strong> ${app?.name || 'Unknown'}</p>
                    </div>
                    <button class="delete-btn" onclick="app.deleteIntegration('${integration.id}')" title="Delete Integration">
                        🗑️
                    </button>
                </div>
                <div style="margin-top: 8px;">
                    <span class="status-badge ${integration.oauth1?.tokens ? 'status-connected clickable' : 'status-disconnected'}" 
                          ${integration.oauth1?.tokens ? `onclick="app.showOAuth1Menu('${integration.id}', event)"` : ''}>
                        OAuth1 ${integration.oauth1?.tokens ? 'Connected' : 'Disconnected'}
                    </span>
                    <span class="status-badge ${integration.oauth2?.tokens ? 'status-connected clickable' : 'status-disconnected'}" 
                          ${integration.oauth2?.tokens ? `onclick="app.showOAuth2Menu('${integration.id}', event)"` : ''}>
                        OAuth2 ${integration.oauth2?.tokens ? 'Connected' : 'Disconnected'}
                    </span>
                </div>
            </div>
            
            <div class="oauth-buttons">
                <button class="btn btn-secondary" onclick="app.startOAuth1('${integration.id}')">
                    OAuth1 Login
                </button>
                <button class="btn btn-primary" onclick="app.startOAuth2('${integration.id}')">
                    OAuth2 Login
                </button>
                ${(integration.oauth1?.tokens || integration.oauth2?.tokens) ? `
                    <button class="btn btn-chat" onclick="app.startChat('${integration.id}')">
                        💬 Chat
                    </button>
                ` : ''}
            </div>
        `;

        return card;
    }

    showAddCredentialsModal() {
        document.getElementById('addCredentialsModal').style.display = 'block';
        document.getElementById('credentialsName').focus();
    }

    showAddIntegrationModal() {
        this.populateAppSelect();
        document.getElementById('addIntegrationModal').style.display = 'block';
        document.getElementById('integrationName').focus();
    }

    hideAllModals() {
        document.getElementById('addCredentialsModal').style.display = 'none';
        document.getElementById('addIntegrationModal').style.display = 'none';
        document.getElementById('chatModal').style.display = 'none';
        document.getElementById('webhookModal').style.display = 'none';
        document.getElementById('subscriptionsModal').style.display = 'none';
        document.getElementById('webhookEventsModal').style.display = 'none';
        this.stopEventStream();
        this.clearForms();
    }

    clearForms() {
        document.getElementById('appId').value = '';
        document.getElementById('credentialsName').value = '';
        document.getElementById('oauthCallbackUrl').value = '';
        document.getElementById('consumerKey').value = '';
        document.getElementById('consumerSecret').value = '';
        document.getElementById('clientId').value = '';
        document.getElementById('clientSecret').value = '';
        document.getElementById('integrationName').value = '';
        document.getElementById('appSelect').value = '';
    }

    populateAppSelect() {
        const select = document.getElementById('appSelect');
        select.innerHTML = '<option value="">Select Application</option>';
        this.credentials.forEach(cred => {
            const option = document.createElement('option');
            option.value = cred.appId;
            option.textContent = `${cred.appId} - ${cred.name}`;
            select.appendChild(option);
        });
    }

    waitForWindowClose(authWindow) {
        const checkClosed = setInterval(async () => {
            if (authWindow.closed) {
                clearInterval(checkClosed);
                await this.loadIntegrations();
            }
        }, 1000);
    }

    async createCredentials() {
        const appId = document.getElementById('appId').value.trim();
        const name = document.getElementById('credentialsName').value.trim();
        const oauthCallbackUrl = document.getElementById('oauthCallbackUrl').value.trim();
        const consumer_key = document.getElementById('consumerKey').value.trim();
        const consumer_secret = document.getElementById('consumerSecret').value.trim();
        const client_id = document.getElementById('clientId').value.trim();
        const client_secret = document.getElementById('clientSecret').value.trim();

        if (!appId || !name || !oauthCallbackUrl) return;

        try {
            const response = await fetch('/credentials', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ appId, name, oauthCallbackUrl, consumer_key, consumer_secret, client_id, client_secret }),
            });

            if (response.ok) {
                this.hideAllModals();
                await this.loadCredentials();
            } else {
                alert('Failed to create credentials');
            }
        } catch (error) {
            console.error('Failed to create credentials:', error);
            alert('Failed to create credentials');
        }
    }

    async createIntegration() {
        const name = document.getElementById('integrationName').value.trim();
        const appId = document.getElementById('appSelect').value;
        if (!name || !appId) return;

        try {
            const response = await fetch('/integrations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, appId }),
            });

            if (response.ok) {
                this.hideAllModals();
                await this.loadIntegrations();
            } else {
                alert('Failed to create integration');
            }
        } catch (error) {
            console.error('Failed to create integration:', error);
            alert('Failed to create integration');
        }
    }

    async startOAuth1(integrationId) {
        try {
            const response = await fetch(`/integrations/${integrationId}/oauth/login/oauth1`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const data = await response.json();
            if (data.auth_url) {
                const authWindow = window.open(data.auth_url, '_blank');
                this.waitForWindowClose(authWindow);
            } else {
                alert('Failed to start OAuth1 flow');
            }
        } catch (error) {
            console.error('OAuth1 error:', error);
            alert('Failed to start OAuth1 flow');
        }
    }

    async startOAuth2(integrationId) {
        try {
            const response = await fetch(`/integrations/${integrationId}/oauth/login/oauth2`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });

            const data = await response.json();
            if (data.auth_url) {
                const authWindow = window.open(data.auth_url, '_blank');
                this.waitForWindowClose(authWindow);
            } else {
                alert('Failed to start OAuth2 flow');
            }
        } catch (error) {
            console.error('OAuth2 error:', error);
            alert('Failed to start OAuth2 flow');
        }
    }

    async deleteIntegration(integrationId) {
        if (!confirm('Are you sure you want to delete this integration?')) {
            return;
        }

        try {
            const response = await fetch(`/integrations/${integrationId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await this.loadIntegrations();
            } else {
                alert('Failed to delete integration');
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('Failed to delete integration');
        }
    }

    showOAuth1Menu(integrationId, event) {
        event.stopPropagation();
        this.hideAllMenus();
        
        const menu = document.createElement('div');
        menu.className = 'token-menu';
        menu.innerHTML = `
            <button onclick="app.revokeOAuth1('${integrationId}')" class="menu-item">
                🔓 Revoke on X.com
            </button>
        `;
        
        document.body.appendChild(menu);
        this.positionMenu(menu, event);
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', this.hideAllMenus.bind(this), { once: true });
        }, 0);
    }

    showOAuth2Menu(integrationId, event) {
        event.stopPropagation();
        this.hideAllMenus();
        
        const menu = document.createElement('div');
        menu.className = 'token-menu';
        menu.innerHTML = `
            <button onclick="app.refreshOAuth2('${integrationId}')" class="menu-item">
                🔄 Refresh Token
            </button>
            <button onclick="app.revokeOAuth2('${integrationId}')" class="menu-item">
                🔓 Revoke Token
            </button>
        `;
        
        document.body.appendChild(menu);
        this.positionMenu(menu, event);
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', this.hideAllMenus.bind(this), { once: true });
        }, 0);
    }

    positionMenu(menu, event) {
        const rect = event.target.getBoundingClientRect();
        menu.style.position = 'absolute';
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.zIndex = '1000';
    }

    hideAllMenus() {
        document.querySelectorAll('.token-menu').forEach(menu => menu.remove());
    }

    async revokeOAuth1(integrationId) {
        try {
            const response = await fetch(`/integrations/${integrationId}/oauth1/revoke`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.redirect_url) {
                window.open(data.redirect_url, '_blank');
            }
        } catch (error) {
            console.error('Revoke OAuth1 error:', error);
        }
        this.hideAllMenus();
    }

    async revokeOAuth2(integrationId) {
        if (!confirm('Are you sure you want to revoke the OAuth2 token?')) {
            return;
        }

        try {
            const response = await fetch(`/integrations/${integrationId}/oauth2/revoke`, {
                method: 'POST'
            });

            if (response.ok) {
                await this.loadIntegrations();
                alert('OAuth2 token revoked successfully');
            } else {
                alert('Failed to revoke OAuth2 token');
            }
        } catch (error) {
            console.error('Revoke OAuth2 error:', error);
            alert('Failed to revoke OAuth2 token');
        }
        this.hideAllMenus();
    }

    async refreshOAuth2(integrationId) {
        try {
            const response = await fetch(`/integrations/${integrationId}/oauth2/refresh`, {
                method: 'POST'
            });

            if (response.ok) {
                await this.loadIntegrations();
                alert('OAuth2 token refreshed successfully');
            } else {
                const error = await response.json();
                const msg = typeof error.error === 'string' ? error.error : JSON.stringify(error.error, null, 2);
                alert(`Failed to refresh OAuth2 token: ${msg}`);
            }
        } catch (error) {
            console.error('Refresh OAuth2 error:', error);
            alert('Failed to refresh OAuth2 token');
        }
        this.hideAllMenus();
    }

    async startChat(integrationId) {
        try {
            const response = await fetch(`/integrations/${integrationId}/dm/followers`);
            const followers = await response.json();
            
            console.log('Followers loaded:', followers);
            
            if (followers.length === 0) {
                alert('No followers available for DM');
                return;
            }
            
            this.showChatModal(integrationId, followers);
        } catch (error) {
            console.error('Failed to load followers:', error);
            alert('Failed to load followers');
        }
    }

    showChatModal(integrationId, followers) {
        console.log('showChatModal called with:', integrationId, followers);
        const integration = this.integrations.find(i => i.id === integrationId);
        const availableAuths = [];
        if (integration.oauth1?.tokens) availableAuths.push('oauth1');
        if (integration.oauth2?.tokens) availableAuths.push('oauth2');
        
        console.log('Available auths:', availableAuths);
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
                <h2>Start Chat</h2>
                <div class="chat-setup">
                    <label>Select participant:</label>
                    <select id="participantSelect">
                        ${followers.map(f => `<option value="${f.id}">${f.name} (@${f.username})</option>`).join('')}
                    </select>
                    
                    <label>Select auth method:</label>
                    <select id="authSelect">
                        ${availableAuths.map(auth => `<option value="${auth}">${auth.toUpperCase()}</option>`).join('')}
                    </select>
                    
                    <button class="btn btn-primary" onclick="app.openChatWindow('${integrationId}')">
                        Start Chat
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        console.log('Modal added to DOM');
    }

    openChatWindow(integrationId) {
        const participantId = document.getElementById('participantSelect').value;
        const auth = document.getElementById('authSelect').value;
        const integration = this.integrations.find(i => i.id === integrationId);
        let userId;
        if (auth === 'oauth1') {
            userId = integration.oauth1?.user?.id;
        } else if (auth === 'oauth2') {
            userId = integration.oauth2?.user?.id || integration.oauth1?.user?.id;
        }
        
        console.log('Debug openChatWindow:', {
            participantId,
            auth,
            integration,
            userId,
            oauth1User: integration.oauth1?.user,
            oauth2User: integration.oauth2?.user
        });
        
        if (!participantId || !auth || !userId) {
            alert('Please select participant and auth method');
            return;
        }
        
        // Close the participant selection modal
        document.querySelector('.modal[style*="display: block"]')?.remove();
        
        // Store chat context
        this.chat = { integrationId, userId, participantId, auth, pendingMedia: null, messages: [], mediaIncludes: [] };
        
        document.getElementById('chatAuthMethod').textContent = `Using ${auth.toUpperCase()}`;
        document.getElementById('chatModal').style.display = 'block';
        document.getElementById('chatMessageInput').focus();
        
        this.setupChatFileUpload();
        this.loadChatMessages();
    }

    closeChat() {
        document.getElementById('chatModal').style.display = 'none';
        document.getElementById('chatMessages').innerHTML = '';
        document.getElementById('chatMessageInput').value = '';
        this.chat = null;
    }

    setupChatFileUpload() {
        const fileInput = document.getElementById('chatFileInput');
        const newInput = fileInput.cloneNode(true);
        fileInput.parentNode.replaceChild(newInput, fileInput);
        newInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            this.chat.pendingMedia = { file, name: file.name, type: file.type };
            this.showChatPendingMedia(`📎 ${file.name}`);
        });
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    showChatPendingMedia(text) {
        const container = document.getElementById('chatPendingMedia');
        container.innerHTML = `${text} <button onclick="app.clearChatPendingMedia()">✕</button>`;
        container.style.display = 'flex';
    }

    clearChatPendingMedia() {
        this.chat.pendingMedia = null;
        document.getElementById('chatFileInput').value = '';
        const container = document.getElementById('chatPendingMedia');
        container.style.display = 'none';
        container.innerHTML = '';
    }

    async loadChatMessages() {
        try {
            const { integrationId, userId, participantId, auth } = this.chat;
            const response = await fetch(`/integrations/${integrationId}/conversation/${userId}/${participantId}/messages?auth=${auth}`);
            const data = await response.json();
            
            this.chat.messages = (data.data || []).sort((a, b) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            this.chat.mediaIncludes = data.includes?.media || [];
            
            if (data.includes?.users) {
                const participant = data.includes.users.find(u => u.id === participantId);
                if (participant) {
                    document.getElementById('chatParticipantName').textContent = participant.name;
                }
            }
            
            this.renderChatMessages();
        } catch (error) {
            console.error('Failed to load messages:', error);
            document.getElementById('chatMessages').innerHTML = '<div class="loading">Failed to load messages</div>';
        }
    }

    renderChatMessages() {
        const container = document.getElementById('chatMessages');
        if (this.chat.messages.length === 0) {
            container.innerHTML = '<div class="loading">No messages yet</div>';
            return;
        }
        
        container.innerHTML = this.chat.messages.map(msg => {
            const isOwn = msg.sender_id === this.chat.userId;
            let mediaHtml = '';
            if (msg.attachments?.media_keys) {
                msg.attachments.media_keys.forEach(key => {
                    const media = this.chat.mediaIncludes.find(m => m.media_key === key);
                    if (!media) return;
                    const proxyBase = `/integrations/${this.chat.integrationId}/media/proxy?auth=${this.chat.auth}`;
                    if (media.type === 'photo') {
                        mediaHtml += `<img src="${proxyBase}&url=${encodeURIComponent(media.url)}" class="chat-message-media" alt="Image">`;
                    } else if (media.type === 'video' || media.type === 'animated_gif') {
                        const variant = media.variants?.find(v => v.content_type === 'video/mp4') || media.variants?.[0];
                        const videoUrl = variant?.url || media.url;
                        const poster = media.preview_image_url ? `poster="${proxyBase}&url=${encodeURIComponent(media.preview_image_url)}"` : '';
                        const autoplay = media.type === 'animated_gif' ? 'autoplay muted loop' : '';
                        mediaHtml += `<video src="${proxyBase}&url=${encodeURIComponent(videoUrl)}" class="chat-message-media" controls ${autoplay} ${poster}></video>`;
                    }
                });
            }
            return `
                <div class="chat-message ${isOwn ? 'own' : ''}">
                    <div class="chat-message-content">
                        ${msg.text || ''}
                        ${mediaHtml}
                        <div class="chat-message-time">${new Date(msg.created_at).toLocaleString()}</div>
                    </div>
                </div>
            `;
        }).join('');
        
        container.scrollTop = container.scrollHeight;
    }

    async sendChatMessage() {
        const input = document.getElementById('chatMessageInput');
        const text = input.value.trim();
        const hasPendingFile = !!this.chat.pendingMedia?.file;
        if (!text && !hasPendingFile && !this.chat.pendingMedia?.id) return;
        
        try {
            let mediaId = this.chat.pendingMedia?.id;

            // Upload pending file if not yet uploaded
            if (hasPendingFile) {
                this.showChatPendingMedia(`🔄 Uploading ${this.chat.pendingMedia.name}...`);
                const file = this.chat.pendingMedia.file;
                const base64 = await this.fileToBase64(file);
                const response = await fetch(`/integrations/${this.chat.integrationId}/media/upload?auth=${this.chat.auth}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ media: base64.split(',')[1], media_type: file.type, total_bytes: file.size })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error);
                }

                // Read SSE progress stream
                const reader = response.body.getReader();
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
                            const label = { init: 'Initializing...', append: 'Uploading', finalize: 'Finalizing...', processing: 'Processing...', complete: 'Ready' }[data.step] || data.step;
                            const detail = data.detail ? `${label} — ${data.detail}` : label;
                            this.showChatPendingMedia(`🔄 ${detail}`);
                        }
                        if (data.media_id) result = data;
                    }
                }

                if (!result?.media_id) throw new Error('Upload failed: no media_id returned');
                mediaId = result.media_id;
            }

            this.showChatPendingMedia('🔄 Sending...');
            const { integrationId, userId, participantId, auth } = this.chat;
            const response = await fetch(`/integrations/${integrationId}/conversation/${userId}/${participantId}/send?auth=${auth}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, media_id: mediaId })
            });
            
            if (response.ok) {
                input.value = '';
                this.clearChatPendingMedia();
                await this.loadChatMessages();
            } else {
                const error = await response.json();
                const msg = typeof error.error === 'string' ? error.error : JSON.stringify(error.error, null, 2);
                this.showChatPendingMedia(`❌ ${msg}`);
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            this.showChatPendingMedia(`❌ ${error.message}`);
        }
    }

    // Webhook events

    async showWebhookEventsModal() {
        document.getElementById('webhookEventsModal').style.display = 'block';
        document.getElementById('webhookEventsList').innerHTML = '<div class="loading">Loading events...</div>';
        try {
            const response = await fetch('/webhook-events');
            const events = await response.json();
            this.webhookEvents = events;
            this.renderWebhookEvents(this.webhookEvents);
            this.startEventStream();
        } catch (error) {
            console.error('Failed to load webhook events:', error);
            document.getElementById('webhookEventsList').innerHTML = '<div class="loading">Failed to load events</div>';
        }
    }

    startEventStream() {
        if (this.eventSource) this.eventSource.close();
        this.eventSource = new EventSource('/webhook-events/stream');
        this.eventSource.onmessage = (e) => {
            const event = JSON.parse(e.data);
            this.webhookEvents.unshift(event);
            if (this.webhookEvents.length > 100) this.webhookEvents.pop();
            if (document.getElementById('webhookEventsModal').style.display === 'block') {
                this.renderWebhookEvents(this.webhookEvents);
            }
        };
    }

    stopEventStream() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    classifyEvent(body) {
        if (body.direct_message_events) return 'dm';
        if (body.user_event?.revoke) return 'revoke';
        if (body.follow_events || body.user_event?.follow) return 'follow';
        if (body.data && body.matching_rules) return 'tweet';
        if (body.tweet_create_events) return 'tweet';
        if (body.favorite_events) return 'like';
        return 'unknown';
    }

    getEventIcon(type) {
        const icons = { dm: '💬', revoke: '🔓', follow: '👤', tweet: '🐦', like: '❤️', unknown: '📨' };
        return icons[type] || icons.unknown;
    }

    getEventSummary(event) {
        const body = event.body;
        const type = this.classifyEvent(body);
        const appId = event.url?.match(/\/webhook\/(\d+)/)?.[1] || '';

        if (type === 'dm') {
            const dm = body.direct_message_events[0];
            const senderId = dm.message_create?.sender_id;
            const sender = body.users?.[senderId];
            const text = dm.message_create?.message_data?.text || '';
            const hasAttachment = !!dm.message_create?.message_data?.attachment;
            return {
                icon: this.getEventIcon(type),
                avatar: sender?.profile_image_url_https,
                name: sender?.name || senderId,
                screenName: sender?.screen_name,
                text,
                hasAttachment,
                appId
            };
        }

        if (type === 'revoke') {
            const userId = body.user_event.revoke.source?.user_id;
            const revokedAppId = body.user_event.revoke.target?.app_id;
            return {
                icon: this.getEventIcon(type),
                name: `User ${userId}`,
                text: `Revoked access for app ${revokedAppId}`,
                appId
            };
        }

        if (type === 'follow') {
            const ev = (body.follow_events || [body.user_event?.follow])[0];
            const source = ev?.source || {};
            return {
                icon: this.getEventIcon(type),
                avatar: source.profile_image_url_https,
                name: source.name || 'Unknown',
                screenName: source.screen_name,
                text: `${ev?.type === 'unfollow' ? 'Unfollowed' : 'Followed'} ${ev?.target?.name || 'user'}`,
                appId
            };
        }

        if (type === 'tweet') {
            const tweet = body.data || body.tweet_create_events?.[0];
            const text = tweet?.text || '';
            const authorId = tweet?.author_id;
            const author = body.includes?.users?.find(u => u.id === authorId);
            return {
                icon: this.getEventIcon(type),
                avatar: author?.profile_image_url,
                name: author?.name || authorId || 'Unknown',
                screenName: author?.username,
                text,
                appId
            };
        }

        return {
            icon: this.getEventIcon(type),
            name: 'Unknown event',
            text: Object.keys(body).join(', '),
            appId
        };
    }

    renderWebhookEvents(events) {
        const container = document.getElementById('webhookEventsList');
        if (events.length === 0) {
            container.innerHTML = '<div class="loading">No events recorded</div>';
            return;
        }

        container.innerHTML = events.map((event, i) => {
            const s = this.getEventSummary(event);
            const date = new Date(event.timestamp).toLocaleString();
            const bodyHash = event.filename?.match(/webhook-(\w+)-/)?.[1] || '';
            const dupes = (event.duplicateDates || []).map(d => new Date(d).toLocaleString()).join(', ');

            return `
                <div class="webhook-event" onclick="app.toggleEventJson(${i})">
                    <span class="webhook-event-icon">${s.icon}</span>
                    ${s.avatar ? `<img src="/media/proxy/public?url=${encodeURIComponent(s.avatar)}" class="webhook-event-avatar" onerror="this.style.display='none'">` : ''}
                    <div class="webhook-event-body">
                        <div class="webhook-event-text">
                            <strong>${s.screenName ? `@${s.screenName}` : s.name}</strong>
                            ${s.text}
                            ${s.hasAttachment ? '<span class="attachment">📎</span>' : ''}
                        </div>
                        <div class="webhook-event-meta">
                            <span>${date}</span>
                            <span class="badge">${s.appId}</span>
                            <span class="badge">${bodyHash}</span>
                            ${dupes ? `<span class="duplicate">dupes: ${dupes}</span>` : ''}
                        </div>
                    </div>
                    <span class="webhook-event-expand" id="expand-${i}">▶</span>
                </div>
                <div class="webhook-event-json" id="json-${i}">
                    <pre>${JSON.stringify(event.body, null, 2)}</pre>
                </div>
            `;
        }).join('');
    }

    toggleEventJson(index) {
        const json = document.getElementById(`json-${index}`);
        const expand = document.getElementById(`expand-${index}`);
        json.classList.toggle('open');
        expand.classList.toggle('open');
    }

    // Webhook management

    showWebhookModal() {
        const select = document.getElementById('webhookAppSelect');
        select.innerHTML = this.credentials.map(c => 
            `<option value="${c.appId}">${c.appId} - ${c.name}</option>`
        ).join('');
        select.onchange = () => this.loadWebhooks();
        document.getElementById('webhookModal').style.display = 'block';
        this.loadWebhooks();
    }

    get selectedAppId() {
        return document.getElementById('webhookAppSelect').value;
    }

    async loadWebhooks() {
        const appId = this.selectedAppId;
        if (!appId) return;
        
        try {
            const [webhooksRes, countRes] = await Promise.all([
                fetch(`/credentials/${appId}/webhooks`),
                fetch(`/credentials/${appId}/subscriptions/count`)
            ]);
            
            const webhooksData = await webhooksRes.json();
            const countData = await countRes.json();
            
            this.renderWebhooks(webhooksData.data || []);
            this.renderSubscriptionCount(countData);
        } catch (error) {
            console.error('Failed to load webhooks:', error);
        }
    }

    renderWebhooks(webhooks) {
        const container = document.getElementById('webhooksList');
        if (webhooks.length === 0) {
            container.innerHTML = '<div class="webhook-item">No webhooks registered</div>';
            return;
        }
        
        container.innerHTML = webhooks.map(wh => `
            <div class="webhook-item">
                <div class="webhook-item-info">
                    <div class="webhook-item-url">${wh.url}</div>
                    <div class="webhook-item-meta">
                        ID: ${wh.id} | 
                        Created: ${new Date(wh.created_at).toLocaleString()} | 
                        Valid: <span style="color: ${wh.valid ? '#17bf63' : '#e0245e'}">${wh.valid}</span>
                    </div>
                </div>
                <div class="webhook-item-actions">
                    <button onclick="app.showSubscriptions('${wh.id}')">Subs</button>
                    <button onclick="app.validateWebhook('${wh.id}')">Validate</button>
                    <button onclick="app.deleteWebhook('${wh.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    renderSubscriptionCount(data) {
        const container = document.getElementById('subscriptionCount');
        if (data.data) {
            const d = data.data;
            container.textContent = `${d.account_name}: ${d.subscriptions_count_all} / ${d.provisioned_count} subscriptions (${d.subscriptions_count_direct_messages} DM)`;
        } else {
            container.textContent = JSON.stringify(data, null, 2);
        }
    }

    async createWebhook() {
        const url = document.getElementById('newWebhookUrl').value.trim();
        if (!url) return;
        
        try {
            const response = await fetch(`/credentials/${this.selectedAppId}/webhooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();
            if (!response.ok) {
                const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
                alert(`Failed to create webhook: ${msg}`);
                return;
            }
            document.getElementById('newWebhookUrl').value = '';
            await this.loadWebhooks();
        } catch (error) {
            console.error('Failed to create webhook:', error);
            alert('Failed to create webhook');
        }
    }

    async deleteWebhook(webhookId) {
        if (!confirm('Delete this webhook?')) return;
        try {
            const response = await fetch(`/credentials/${this.selectedAppId}/webhooks/${webhookId}`, { method: 'DELETE' });
            if (response.ok) {
                await this.loadWebhooks();
                alert('Webhook deleted successfully');
            } else {
                const data = await response.json();
                const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
                alert(`Failed to delete webhook: ${msg}`);
            }
        } catch (error) {
            console.error('Failed to delete webhook:', error);
            alert('Failed to delete webhook');
        }
    }

    async validateWebhook(webhookId) {
        try {
            const response = await fetch(`/credentials/${this.selectedAppId}/webhooks/${webhookId}/validate`, { method: 'PUT' });
            const data = await response.json();
            if (response.ok) {
                alert('Webhook validated successfully');
                await this.loadWebhooks();
            } else {
                const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
                alert(`Validation failed: ${msg}`);
            }
        } catch (error) {
            console.error('Failed to validate webhook:', error);
            alert('Failed to validate webhook');
        }
    }

    async showSubscriptions(webhookId) {
        this.currentWebhookId = webhookId;
        document.getElementById('subscriptionsWebhookTitle').textContent = `Webhook: ${webhookId}`;
        
        const select = document.getElementById('subscriptionIntegrationSelect');
        select.innerHTML = this.integrations
            .filter(i => i.appId === this.selectedAppId)
            .map(i => {
                const user = i.oauth1?.user || i.oauth2?.user;
                const label = user ? `${i.name} (@${user.username})` : i.name;
                return `<option value="${i.id}">${label}</option>`;
            })
            .join('');
        
        document.getElementById('subscriptionsModal').style.display = 'block';
        await this.loadSubscriptions(webhookId);
    }

    async loadSubscriptions(webhookId) {
        try {
            const response = await fetch(`/credentials/${this.selectedAppId}/webhooks/${webhookId}/subscriptions`);
            const data = await response.json();
            const subs = data.data?.subscriptions || [];
            
            const container = document.getElementById('subscriptionsList');
            if (subs.length === 0) {
                container.innerHTML = '<div class="webhook-item">No subscriptions</div>';
                return;
            }
            
            // Fetch usernames for all subscription user IDs
            const userIds = subs.map(s => s.user_id).join(',');
            const usersRes = await fetch(`/credentials/${this.selectedAppId}/users?ids=${userIds}`);
            const usersData = await usersRes.json();
            const users = usersData.data || {};
            
            container.innerHTML = subs.map(sub => {
                const user = users[sub.user_id];
                const avatarUrl = user?.profile_image_url 
                    ? `/media/proxy/public?url=${encodeURIComponent(user.profile_image_url)}`
                    : '';
                return `
                    <div class="webhook-item">
                        <div class="webhook-item-info" style="display:flex;align-items:center;gap:8px">
                            ${avatarUrl ? `<img src="${avatarUrl}" class="user-avatar small" onerror="this.style.display='none'">` : ''}
                            <div>
                                <div>${user ? `${user.name} @${user.username}` : sub.user_id}</div>
                                <div class="webhook-item-meta">${sub.user_id}</div>
                            </div>
                        </div>
                        <div class="webhook-item-actions">
                            <button onclick="app.deleteSubscription('${webhookId}', '${sub.user_id}')">Unsubscribe</button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Failed to load subscriptions:', error);
        }
    }

    async createSubscription() {
        const integrationId = document.getElementById('subscriptionIntegrationSelect').value;
        const authType = document.getElementById('subscriptionAuthSelect').value;
        if (!integrationId) return;
        
        try {
            const response = await fetch(`/credentials/${this.selectedAppId}/webhooks/${this.currentWebhookId}/subscriptions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integrationId, authType })
            });
            const data = await response.json();
            if (!response.ok) {
                const msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error, null, 2);
                alert(`Failed to subscribe: ${msg}`);
                return;
            }
            await this.loadSubscriptions(this.currentWebhookId);
            await this.loadWebhooks();
        } catch (error) {
            console.error('Failed to create subscription:', error);
            alert('Failed to create subscription');
        }
    }

    async deleteSubscription(webhookId, userId) {
        if (!confirm('Unsubscribe this user?')) return;
        try {
            await fetch(`/credentials/${this.selectedAppId}/webhooks/${webhookId}/subscriptions/${userId}`, { method: 'DELETE' });
            await this.loadSubscriptions(webhookId);
            await this.loadWebhooks();
        } catch (error) {
            console.error('Failed to delete subscription:', error);
            alert('Failed to delete subscription');
        }
    }
}

// Initialize the app
const app = new TwitterOAuthDemo();
app.init();