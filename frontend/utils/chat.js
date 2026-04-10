class ChatManager {
    constructor() {
        this.messages = []; // All messages (persistent + current session)
        this.currentSessionMessages = []; // Only current session messages for AI context
        this.sessionStartTime = null; // Track when current session started
        this.isTyping = false;
        this.messageContainer = null;
        this.messageInput = null;
        this.sendButton = null;
        this.typingIndicator = null;
        this.clearButton = null;
        this.chatToggle = null;
        this.chatPanel = null;
        this.closeChatButton = null;
        this.isOpen = false;
        this.pendingMessages = new Set(); // Track messages being sent to avoid duplicates

        this.handleSendMessage = this.handleSendMessage.bind(this);
        this.handleKeyPress = this.handleKeyPress.bind(this);
        this.handleClearChat = this.handleClearChat.bind(this);
        this.handleToggleChat = this.handleToggleChat.bind(this);
        this.handleCloseChat = this.handleCloseChat.bind(this);
    }

    initialize() {
        try {
            this.messageContainer = document.getElementById('chatMessages');
            this.messageInput = document.getElementById('messageInput');
            this.sendButton = document.getElementById('sendBtn');
            this.typingIndicator = document.getElementById('typingIndicator');
            this.clearButton = document.getElementById('clearChatBtn');
            this.chatToggle = document.getElementById('chatToggle');
            this.chatPanel = document.getElementById('chatPanel');
            this.closeChatButton = document.getElementById('closeChatBtn');

            if (!this.messageContainer || !this.messageInput || !this.sendButton) {
                throw new Error('Required chat elements not found');
            }

            this.sendButton.addEventListener('click', this.handleSendMessage);
            this.messageInput.addEventListener('keypress', this.handleKeyPress);
            this.clearButton?.addEventListener('click', this.handleClearChat);
            this.chatToggle?.addEventListener('click', this.handleToggleChat);
            this.closeChatButton?.addEventListener('click', this.handleCloseChat);

            // Load persistent chat history first, then display
            // this.loadPersistentHistory();
            this.displayAllMessages();
            console.log('Chat manager initialized');
            return true;

        } catch (error) {
            console.error('Failed to initialize chat manager:', error);
            return false;
        }
    }

    async handleSendMessage() {
        const message = this.messageInput.value.trim();
        if (message && !this.isTyping) {
            try {
                // Check if conversation is active and RTM is available
                if (window.sendTextMessage) {
                    // Add to pending messages to track it
                    this.pendingMessages.add(message);

                    // Display immediately for better UX
                    this.sendMessage(message, 'user');

                    // Send via RTM to the AI assistant
                    await window.sendTextMessage(message);

                    // Remove from pending after a delay (in case RTM echo doesn't come back)
                    setTimeout(() => {
                        this.pendingMessages.delete(message);
                    }, 5000);
                } else {
                    // Fallback: just display locally if not connected
                    this.sendMessage(message, 'user');
                }
                this.messageInput.value = '';
            } catch (error) {
                console.error('Failed to send message:', error);
                this.pendingMessages.delete(message);
                // Message already displayed, just show error
                UTILS.showToast('Failed to send message to AI', 'error');
                this.messageInput.value = '';
            }
        }
    }

    handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handleSendMessage();
        }
    }

    handleClearChat() {
        if (confirm('Are you sure you want to clear the chat history?')) {
            this.clearMessages();
        }
    }

    sendMessage(content, sender = 'user') {
        const message = {
            id: Date.now(),
            content: content,
            sender: sender,
            timestamp: new Date()
        };

        this.messages.push(message);
        
        // Add to current session if session is active
        if (this.sessionStartTime) {
            this.currentSessionMessages.push(message);
        }
        
        this.displayMessage(message);
        // this.saveMessageHistory();
        this.scrollToBottom();

        console.log('Message sent:', message);
    }

    receiveRtmMessage(rtmData) {
        try {
            console.log('Received RTM data:', rtmData);

            // Handle user transcription
            if (rtmData.object === 'user.transcription') {
                if (rtmData.final === true && rtmData.text) {
                    // Check if this message was just sent by us (avoid duplicate)
                    if (this.pendingMessages.has(rtmData.text)) {
                        console.log('Skipping duplicate message (already displayed):', rtmData.text);
                        this.pendingMessages.delete(rtmData.text);
                        return;
                    }

                    // Only display final user transcription (from voice input)
                    this.sendMessage(rtmData.text, 'user');
                } else if (rtmData.final === false) {
                    // User is still speaking
                    console.log('User speaking (partial):', rtmData.text);
                }
            }
            // Handle assistant transcription
            else if (rtmData.object === 'assistant.transcription') {
                if (rtmData.text) {
                    // Assistant messages come in chunks, update the last message
                    // or create new one if it's the first chunk
                    this.updateOrCreateAssistantMessage(rtmData.text, rtmData.turn_id);
                }
            }
        } catch (error) {
            console.error('Error receiving RTM message:', error);
        }
    }

    updateOrCreateAssistantMessage(text, turnId) {
        const lastMessage = this.getLastMessage();

        // Check if the last message is from the assistant with the same turn_id
        if (lastMessage &&
            lastMessage.sender === 'ai' &&
            lastMessage.turnId === turnId) {
            // Update the existing message
            lastMessage.content = text;
            this.updateLastMessage(lastMessage);
        } else {
            // Create a new message
            const message = {
                id: Date.now(),
                content: text,
                sender: 'ai',
                timestamp: new Date(),
                turnId: turnId
            };
            this.messages.push(message);
            
            // Add to current session if session is active
            if (this.sessionStartTime) {
                this.currentSessionMessages.push(message);
            }
            
            this.displayMessage(message);
            // this.saveMessageHistory();
            this.scrollToBottom();
        }
    }

    updateLastMessage(message) {
        // Find and update the last message in the DOM
        const messageElements = this.messageContainer.querySelectorAll('.message.ai');
        if (messageElements.length > 0) {
            const lastElement = messageElements[messageElements.length - 1];
            const contentP = lastElement.querySelector('.message-content p');
            if (contentP) {
                contentP.textContent = message.content;
            }
        }
        // this.saveMessageHistory();
        this.scrollToBottom();
    }

    displayMessage(message) {
        if (!this.messageContainer) return;

        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.sender}`;
        messageElement.innerHTML = `
            <div class="message-content">
                <p>${this.escapeHtml(message.content)}</p>
                <span class="timestamp">${UTILS.formatTime(message.timestamp)}</span>
            </div>
        `;

        this.messageContainer.appendChild(messageElement);
    }

    showTypingIndicator() {
        if (this.typingIndicator && !this.isTyping) {
            this.isTyping = true;
            this.typingIndicator.style.display = 'flex';
            this.scrollToBottom();
        }
    }

    hideTypingIndicator() {
        if (this.typingIndicator && this.isTyping) {
            this.isTyping = false;
            this.typingIndicator.style.display = 'none';
        }
    }

    clearMessages() {
        this.messages = [];
        if (this.messageContainer) {
            this.messageContainer.innerHTML = '';
            // this.addWelcomeMessage();
        }
        // this.saveMessageHistory();
        console.log('Chat cleared');
    }

    scrollToBottom() {
        if (this.messageContainer) {
            setTimeout(() => {
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
            }, 100);
        }
    }

    enableChat() {
        if (this.messageInput && this.sendButton) {
            this.messageInput.disabled = false;
            this.sendButton.disabled = false;
            this.messageInput.placeholder = "Type your message...";
        }
        
        // Show chat toggle button
        if (this.chatToggle) {
            this.chatToggle.style.display = 'flex';
        }
    }

    disableChat() {
        // Close chat panel if open
        this.closeChat();

        if (this.messageInput && this.sendButton) {
            this.messageInput.disabled = true;
            this.sendButton.disabled = true;
            this.messageInput.placeholder = "Start the conversation to begin chatting...";
        }
        this.hideTypingIndicator();
        
        // Hide chat toggle button
        if (this.chatToggle) {
            this.chatToggle.style.display = 'none';
        }
    }

    // saveMessageHistory() {
    //     // Save last 50 messages to local storage for persistence
    //     STORAGE.set('chatHistory', this.messages.slice(-50));
    // }

    // loadPersistentHistory() {
    //     const history = STORAGE.get('chatHistory', []);
    //     if (history.length > 0) {
    //         this.messages = history.map(msg => ({
    //             ...msg,
    //             timestamp: new Date(msg.timestamp)
    //         }));
    //         console.log('Loaded', this.messages.length, 'messages from history');
    //     } else {
    //         this.messages = [];
    //         console.log('No chat history found');
    //     }
    // }

    displayAllMessages() {
        if (!this.messageContainer) {
            console.error('Message container not found');
            return;
        }

        // Clear container first
        this.messageContainer.innerHTML = '';

        if (this.messages.length > 0) {
            // Display all historical messages
            this.messages.forEach(msg => this.displayMessage(msg));
            console.log('Displayed', this.messages.length, 'historical messages');
        } 
        // else {
        //     // Add welcome message if no history exists
        //     this.addWelcomeMessage();
        // }
        
        this.scrollToBottom();
    }

    // addWelcomeMessage() {
    //     const welcomeMessage = {
    //         id: Date.now(),
    //         content: '👋 Hi! I\'m your AI assistant. Start chatting with voice or text!',
    //         sender: 'system',
    //         timestamp: new Date()
    //     };
    //     this.messages.push(welcomeMessage);
    //     this.displayMessage(welcomeMessage);
    //     this.saveMessageHistory();
    // }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getMessageCount() {
        return this.messages.length;
    }

    getLastMessage() {
        return this.messages[this.messages.length - 1] || null;
    }

    handleToggleChat() {
        this.isOpen = !this.isOpen;
        if (this.chatPanel) {
            this.chatPanel.classList.toggle('active', this.isOpen);
        }
    }

    handleCloseChat() {
        this.isOpen = false;
        if (this.chatPanel) {
            this.chatPanel.classList.remove('active');
        }
    }

    openChat() {
        this.isOpen = true;
        if (this.chatPanel) {
            this.chatPanel.classList.add('active');
        }
    }

    closeChat() {
        this.isOpen = false;
        if (this.chatPanel) {
            this.chatPanel.classList.remove('active');
        }
    }

    // Session management methods
    startNewSession() {
        this.sessionStartTime = new Date();
        this.currentSessionMessages = [];
        console.log('New chat session started at:', this.sessionStartTime);
    }

    endSession() {
        this.sessionStartTime = null;
        console.log('Chat session ended. Session had', this.currentSessionMessages.length, 'messages');
    }

    getCurrentSessionMessages() {
        return this.currentSessionMessages || [];
    }

    isSessionActive() {
        return this.sessionStartTime !== null;
    }
}