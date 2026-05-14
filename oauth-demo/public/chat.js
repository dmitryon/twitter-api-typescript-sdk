class TwitterChat {
    constructor() {
        this.pendingMedia = null;
        this.messages = [];
        this.mediaIncludes = [];
        this.parseUrlParams();
    }

    parseUrlParams() {
        const pathParts = window.location.pathname.split('/');
        this.integrationId = pathParts[2];
        this.userId = pathParts[4];
        this.participantId = pathParts[5];
        this.auth = new URLSearchParams(window.location.search).get('auth');
        document.getElementById('authMethod').textContent = `Using ${this.auth?.toUpperCase()}`;
    }

    async init() {
        await this.loadMessages();
        document.getElementById('fileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            this.pendingMedia = { file, name: file.name, type: file.type };
            this.showStatus(`📎 ${file.name}`);
        });
        document.getElementById('messageInput').focus();
    }

    // Messages

    async loadMessages() {
        try {
            const response = await fetch(`/integrations/${this.integrationId}/conversation/${this.userId}/${this.participantId}/messages?auth=${this.auth}`);
            const data = await response.json();
            this.messages = (data.data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            this.mediaIncludes = data.includes?.media || [];
            this.renderMessages();
            const participant = data.includes?.users?.find(u => u.id === this.participantId);
            if (participant) document.getElementById('participantName').textContent = participant.name;
        } catch (error) {
            document.getElementById('chatMessages').innerHTML = '<div class="loading">Failed to load messages</div>';
        }
    }

    renderMessages() {
        const container = document.getElementById('chatMessages');
        if (this.messages.length === 0) {
            container.innerHTML = '<div class="loading">No messages yet</div>';
            return;
        }
        container.innerHTML = '';
        this.messages.forEach(msg => container.appendChild(this.createMessageElement(msg)));
        container.scrollTop = container.scrollHeight;
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        div.className = `message ${message.sender_id === this.userId ? 'own' : ''}`;

        let mediaHtml = '';
        (message.attachments?.media_keys || []).forEach(key => {
            const media = this.mediaIncludes.find(m => m.media_key === key);
            if (!media) return;
            const proxy = (url) => `/integrations/${this.integrationId}/media/proxy?auth=${this.auth}&url=${encodeURIComponent(url)}`;
            if (media.type === 'photo') {
                mediaHtml += `<img src="${proxy(media.url)}" class="message-media" alt="Image">`;
            } else if (media.type === 'video' || media.type === 'animated_gif') {
                const videoUrl = (media.variants?.find(v => v.content_type === 'video/mp4') || media.variants?.[0])?.url || media.url;
                const poster = media.preview_image_url ? `poster="${proxy(media.preview_image_url)}"` : '';
                const autoplay = media.type === 'animated_gif' ? 'autoplay muted loop' : '';
                mediaHtml += `<video src="${proxy(videoUrl)}" class="message-media" controls ${autoplay} ${poster}></video>`;
            }
        });

        div.innerHTML = `
            <div class="message-content">
                ${message.text || ''}
                ${mediaHtml}
                <div class="message-time">${new Date(message.created_at).toLocaleString()}</div>
            </div>
        `;
        return div;
    }

    // Send

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        if (!text && !this.pendingMedia) return;

        try {
            let mediaId = null;

            if (this.pendingMedia?.file) {
                this.showStatus(`🔄 Uploading ${this.pendingMedia.name}...`);
                mediaId = await this.uploadMedia(this.pendingMedia.file);
            }

            this.showStatus('🔄 Sending...');
            const response = await fetch(`/integrations/${this.integrationId}/conversation/${this.userId}/${this.participantId}/send?auth=${this.auth}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, media_id: mediaId })
            });

            if (response.ok) {
                input.value = '';
                this.clearPendingMedia();
                await this.loadMessages();
            } else {
                const err = await response.json();
                this.showStatus(`❌ ${err.error || 'Send failed'}`);
            }
        } catch (error) {
            this.showStatus(`❌ ${error.message}`);
        }
    }

    // Upload with SSE progress

    async uploadMedia(file) {
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        const response = await fetch(`/integrations/${this.integrationId}/media/upload?auth=${this.auth}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media: base64.split(',')[1], media_type: file.type, total_bytes: file.size })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error);
        }

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
                    this.showStatus(`🔄 ${data.detail ? `${label} — ${data.detail}` : label}`);
                }
                if (data.media_id) result = data;
            }
        }

        if (!result?.media_id) throw new Error('Upload failed: no media_id returned');
        return result.media_id;
    }

    // Status bar

    showStatus(text) {
        const container = document.getElementById('pendingMedia');
        const isProgress = text.startsWith('🔄');
        container.innerHTML = isProgress
            ? `<div class="uploading-media-item"><span>${text}</span><div class="spinner"></div></div>`
            : `<div class="pending-media-item"><span>${text}</span><button onclick="chat.clearPendingMedia()">✕</button></div>`;
        container.style.display = 'block';
    }

    clearPendingMedia() {
        this.pendingMedia = null;
        document.getElementById('fileInput').value = '';
        document.getElementById('pendingMedia').style.display = 'none';
    }
}

function handleKeyPress(event) {
    if (event.key === 'Enter') chat.sendMessage();
}

const chat = new TwitterChat();
chat.init();
