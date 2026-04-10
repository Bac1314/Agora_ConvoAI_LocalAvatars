// Secure app wrapper to prevent console access to SDK variables
(function() {

  // ===========================
  // AGORA SDK VARIABLES
  // ===========================
  let rtcClient = null;
  let rtcLocalAudioTrack;
  let rtcJoined = false;
  let rtcRemoteUsers = {};
  let rtmClient = null;
  let agoraConvoAIAgentID = null;
  let agoraChannel = null;
  let agoraUserUID = 123;
  let agoraChannelInfo = null;
  let agentUID = null;
  let agentState = 'idle';
  let chatManager = null;

  // VRM avatar manager
  let vrmManager = null;

  // UI Elements
  const joinBtn = document.getElementById('join');
  const leaveBtn = document.getElementById('leave');

  // ===========================
  // INITIALIZATION
  // ===========================

  init();

  async function init() {
    try {
      // Step 1 — Fetch AppID, channel name, tokens from backend
      agoraChannel = UTILS.generateChannelName();
      agoraChannelInfo = await API.agora.getChannelInfo(agoraChannel, agoraUserUID);

      // Step 2a — Initialize RTC client
      if (rtcClient == null) {
        rtcClient = AgoraRTC.createClient({ mode: "live", codec: "vp8", role: 'host' });
        rtcClient.on("user-published", handleRTCUserPublished);
        rtcClient.on("user-unpublished", handleRTCUserUnpublished);
      }

      // Step 2b — Initialize RTM client
      if (rtmClient == null) {
        rtmClient = new AgoraRTM.RTM(agoraChannelInfo.appId, agoraUserUID.toString());
        rtmClient.addEventListener('message', handleRTMMessage);
        rtmClient.addEventListener('presence', handleRTMPresenceEvent);
      }

      // Step 3 — UI event listeners
      joinBtn.addEventListener('click', handleStartClick);
      leaveBtn.addEventListener('click', handleStopClick);

      // Step 4 — Chat manager
      chatManager = new ChatManager();
      if (chatManager.initialize()) {
        console.log('Chat manager initialized successfully');
      }

      // Step 5 — Populate avatar dropdown
      populateAvatarSelector();

      // Step 6 — Initialize VRM avatar immediately (renders idle before any conversation)
      vrmManager = new VrmAvatarManager();
      try {
        await vrmManager.init('avatar-container', CONFIG.VRM_MODEL_URL);
        console.log('VRM avatar initialized');
      } catch (err) {
        console.error('VRM avatar failed to initialize:', err);
      }

    } catch (e) {
      console.error('Init failed', e);
    }
  }

  // ===========================
  // AVATAR SELECTOR
  // ===========================

  function populateAvatarSelector() {
    const select = document.getElementById('avatarSelect');
    if (!select) return;

    CONFIG.AVAILABLE_AVATARS.forEach((avatar) => {
      const option = document.createElement('option');
      option.value = avatar.file;
      option.textContent = avatar.name;
      if (avatar.file === CONFIG.VRM_MODEL_URL) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
      if (!vrmManager) return;
      select.disabled = true;
      try {
        await vrmManager.switchModel(e.target.value);
      } catch (err) {
        console.error('Failed to switch avatar:', err);
      } finally {
        select.disabled = false;
      }
    });
  }

  // ===========================
  // AGORA CONVO AI FUNCTIONS
  // ===========================

  async function startAgoraConvoAIAgent() {
    try {
      if (!agoraChannelInfo) return alert('Channel info not initialized');

      await joinRTCChannel(agoraChannelInfo.appId, agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);
      await joinRTMChannel(agoraChannelInfo.channel, agoraChannelInfo.uid, agoraChannelInfo.token);

      const response = await API.agora.startConversation({
        channel: agoraChannelInfo.channel,
        agentName: "AgoraConvoAI_" + agoraChannelInfo.channel,
        remoteUid: agoraUserUID,
      });

      agoraConvoAIAgentID = response.agentId;
      agentUID = response.agentUid;

    } catch (e) {
      console.error('Failed to start ConvoAI agent', e);
      onConversationError();
    }
  }

  async function stopAgoraConvoAIAgent() {
    try {
      if (!agoraConvoAIAgentID) return;

      if (rtcJoined) {
        await rtcLeaveChannel();
        await rtmLeaveChannel();
      }

      // Disconnect audio from avatar but keep it rendering in idle state
      if (vrmManager) {
        vrmManager.disconnectAudio();
        vrmManager.setAgentState('idle');
        vrmManager.playPose('idle');
      }

      onConversationStopped();

      await API.agora.stopConversation(agoraConvoAIAgentID);
      agoraConvoAIAgentID = null;
      agentUID = null;

    } catch (e) {
      console.error('Failed to stop ConvoAI agent', e);
      onConversationError();
    }
  }

  // ===========================
  // AGORA RTC FUNCTIONS
  // ===========================

  async function joinRTCChannel(appId, channel, uid, token) {
    rtcLocalAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();

    try {
      await rtcClient.join(appId, channel, token || null, uid);
      await rtcClient.publish([rtcLocalAudioTrack]);
      rtcJoined = true;
    } catch (err) {
      console.error(err);
      alert('Failed to join/publish: ' + err.message);
    }
  }

  async function rtcSubscribe(user, mediaType) {
    if (mediaType === 'audio') {
      await rtcClient.subscribe(user, mediaType);
      user.audioTrack.play();
    }
  }

  async function rtcLeaveChannel() {
    if (rtcLocalAudioTrack) {
      rtcLocalAudioTrack.close();
      rtcLocalAudioTrack = null;
    }
    await rtcClient.leave();
    rtcJoined = false;
  }

  function handleRTCUserPublished(user, mediaType) {
    const id = user.uid;
    rtcRemoteUsers[id] = user;
    rtcSubscribe(user, mediaType);

    if (mediaType === 'audio') {
      // Capture the real agent UID from the RTC event — the ConvoAI service may
      // join with a different UID than the one we sent as agent_rtc_uid.
      agentUID = id;
      onConversationStarted();

      // Connect agent audio to VRM avatar for lip-sync analysis
      setTimeout(() => {
        if (vrmManager) {
          vrmManager.connectAudioTrack(user.audioTrack);
        }
      }, 500);
    }
  }

  function handleRTCUserUnpublished(user) {
    const id = user.uid;
    delete rtcRemoteUsers[id];

    if (id == agentUID) {
      if (vrmManager) {
        vrmManager.disconnectAudio();
      }
      updateAgentStateUI('offline');
    }
  }

  // ===========================
  // AGORA RTM FUNCTIONS
  // ===========================

  async function joinRTMChannel(channel, uid, token) {
    try {
      await rtmClient.login({ token: token || null, uid: uid.toString() });
      await rtmClient.subscribe(channel);
    } catch (err) {
      console.error('RTM join failed', err);
    }
  }

  async function rtmLeaveChannel() {
    try {
      const unsubResult = await rtmClient.unsubscribe(agoraChannel);
      console.log('RTM unsubscribe result:' + unsubResult);
    } catch (status) {
      console.log(status);
    }
  }

  function handleRTMMessage(event) {
    try {
      if (event.channelType === 'MESSAGE' && event.channelName === agoraChannel) {
        const message = event.message;
        if (typeof message === 'string') {
          try {
            const parsedMessage = JSON.parse(message);
            if (chatManager && parsedMessage) {
              chatManager.receiveRtmMessage(parsedMessage);
            }
          } catch (e) {
            console.log('Message is not JSON:', message);
          }
        }
      }
    } catch (error) {
      console.error('Error handling RTM message:', error);
    }
  }

  function handleRTMPresenceEvent(event) {
    try {
      if (event.eventType === 'REMOTE_STATE_CHANGED') {
        if (event.publisher !== agoraUserUID?.toString()) {
          const stateChanged = event.stateChanged || {};
          if (stateChanged.state) {
            agentState = stateChanged.state;
            console.log('Agent state changed to:', agentState);
            updateAgentStateUI(agentState);
          }
        }
      }
    } catch (error) {
      console.error('Error handling RTM presence event:', error);
    }
  }

  // ===========================
  // TEXT MESSAGING
  // ===========================

  async function sendTextMessage(text) {
    try {
      if (!rtmClient || !agoraChannel || !rtcJoined) {
        throw new Error('RTM client not initialized or not connected to channel');
      }
      await rtmClient.publish(agoraChannel, text, { customType: "user.transcription" });
      return true;
    } catch (error) {
      console.error('Failed to send text message via RTM:', error);
      throw error;
    }
  }

  window.sendTextMessage = sendTextMessage;

  // ===========================
  // UI MANAGEMENT
  // ===========================

  async function handleStartClick() {
    setButtonLoading(joinBtn, true);
    await startAgoraConvoAIAgent();
  }

  async function handleStopClick() {
    setButtonLoading(leaveBtn, true);
    await stopAgoraConvoAIAgent();
  }

  function onConversationStarted() {
    setButtonLoading(joinBtn, false);
    joinBtn.disabled = true;
    leaveBtn.disabled = false;

    updateAgentStateUI('speaking');

    if (chatManager) {
      chatManager.enableChat();
      chatManager.startNewSession();
    }
  }

  function onConversationStopped() {
    setButtonLoading(leaveBtn, false);
    joinBtn.disabled = false;
    leaveBtn.disabled = true;

    updateAgentStateUI('offline');

    if (chatManager) {
      chatManager.disableChat();
      chatManager.endSession();
    }
  }

  function onConversationError() {
    setButtonLoading(joinBtn, false);
    setButtonLoading(leaveBtn, false);
  }

  function setButtonLoading(button, loading) {
    if (loading) {
      button.classList.add('loading');
    } else {
      button.classList.remove('loading');
    }
  }

  function updateAgentStateUI(state) {
    const agentStateEl = document.getElementById('agent-state');
    const stateTextEl = document.querySelector('.state-text');

    if (agentStateEl && stateTextEl) {
      const stateLabels = {
        'thinking': 'thinking',
        'idle': 'idle',
        'speaking': 'speaking',
        'listening': 'listening',
        'silent': 'silent',
        'offline': 'offline',
        'online': 'online'
      };
      const displayText = stateLabels[state.toLowerCase()] || state;
      stateTextEl.textContent = displayText;
      agentStateEl.className = 'agent-state';
      agentStateEl.classList.add(`state-${state.toLowerCase()}`);
    }

    // Drive VRM avatar based on agent state
    if (vrmManager) {
      const normalizedState = state.toLowerCase();
      vrmManager.setAgentState(normalizedState);

      // Trigger body pose transitions based on state
      switch (normalizedState) {
        case 'thinking':
          vrmManager.playPose('thinking');
          break;
        case 'speaking':
          vrmManager.playPose('speaking');
          break;
        case 'listening':
          vrmManager.playPose('listening');
          break;
        case 'idle':
        case 'silent':
        case 'offline':
          vrmManager.playPose('idle');
          break;
        default:
          break;
      }
    }
  }

})();
