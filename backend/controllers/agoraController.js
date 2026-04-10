const axios = require('axios');
const { AccessToken2, ServiceRtc, ServiceRtm } = require('agora-token/src/AccessToken2');

// Note: User returning status is now determined by presence of chat history

const getChannelInfo = (req, res) => {
  const { channel, uid } = req.query;

  if (!channel || !uid) {
    return res.status(400).json({ error: 'Channel and uid are required' });
  }

  try {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    // If the server has the app certificate, generate an ephemeral token and return it.
    if (appCertificate) {
      try {
        const result = buildUnifiedToken(appId, appCertificate, channel, uid);
        return res.json({
          appId,
          channel,
          uid: parseInt(uid),
          token: result.token,
          expiresIn: result.expiresIn
        });
      } catch (err) {
        console.error('Failed to build token inside getChannelInfo:', err);
        // fallthrough to return public info without token
      }
    }

    // Return public channel/app information when token cannot be generated
    res.json({
      appId,
      channel,
      uid: parseInt(uid),
      token: null,
      expiresIn: 0
    });
  } catch (error) {
    console.error('Channel info error:', error);
    res.status(500).json({ error: 'Failed to get channel info' });
  }
};

const startConversation = async (req, res) => {
  try {
    const { channel, agentName, remoteUid: userUid, voiceId } = req.body;
    
    if (!channel || !agentName || !userUid) {
      return res.status(400).json({ 
        error: 'Channel, agentName, and remoteUid are required' 
      });
    }

    const agentUid = Math.floor(Math.random() * 100000) + 1000;

    // Check if credentials are configured
    if (!process.env.AGORA_API_KEY || !process.env.AGORA_API_SECRET || !process.env.AGORA_APP_ID) {
      console.log('Agora credentials not configured, returning demo response');
      return res.json({
        success: true,
        agentId: `DEMO_AGENT_${Date.now()}`,
        agentUid: agentUid,
        channel: channel,
        demo: true,
        message: 'Demo mode - configure API credentials for full functionality'
      });
    }

    // Use provided system prompt or fall back to env variable or default
    const defaultSystemPrompt = process.env.LLM_SYSTEM_PROMPT || "You are a friendly AI companion";
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    const agentToken = appCertificate ? buildUnifiedToken(appId, appCertificate, channel, agentUid).token : "";

    const requestBody = {
      name: agentName,
      properties: {
        channel: channel,
        token: agentToken,
        agent_rtc_uid: agentUid.toString(),
        remote_rtc_uids: [userUid.toString()],
        enable_string_uid: false,
        idle_timeout: 30,
        asr: {
          vendor: "ares",
          language: "en-US"
        },
        llm: {
          url: process.env.LLM_URL,
          api_key: process.env.LLM_API_KEY,
          system_messages: [
            {
              role: "system",
              content: defaultSystemPrompt
            }
          ],
          greeting_message: "Hello there! I'm your AI assistant. How can I help you today?",
          failure_message: "Sorry, I'm having some trouble right now. Let me try again!",
          params: {
            model: process.env.LLM_MODEL || "gpt-4o-mini"
          },
          input_modalities: ["text"],
          output_modalities: ["text"]
        },
        tts: { 
          vendor: "minimax", 
          params: { 
            url: "wss://api-uw.minimax.io/ws/v1/t2a_v2",
            key: process.env.TTS_MINIMAX_API_KEY,
            group_id: process.env.TTS_MINIMAX_GROUP_ID,
            model: "speech-2.6-turbo",
            voice_setting: {
              voice_id: voiceId || process.env.TTS_MINIMAX_VOICE_ID
            },
            audio_setting: {
              sample_rate: 16000,
            }
          }
        },
        turn_detection: {
          mode: "default",
          config: {
            speech_threshold: 0.5,
            start_of_speech: {
              mode: "vad",
              vad_config: {
                interrupt_duration_ms: 160,
                speaking_interrupt_duration_ms: 320,
                prefix_padding_ms: 800
              }
            },
            end_of_speech: {
              mode: "semantic",
              semantic_config: {
                silence_duration_ms: 320,
                max_wait_ms: 3000
              }
            }
          }
        },
        advanced_features: {
          enable_bhvs: true,
          enable_rtm: true
        },
        parameters: {
          data_channel: "rtm",
          audio_scenario: "chorus",
          transcript: {
            redundant: false
          },
          silence_config: { 
            timeout_ms: 30000, // 30 seconds of silence detection
            action: "think", // Agent will think/respond after silence
            content: "User hasn't spoken for a while. Engage the user with a question or prompt."
          }
        }
      }
    };

    const auth = Buffer.from(`${process.env.AGORA_API_KEY}:${process.env.AGORA_API_SECRET}`).toString('base64');
    
    const response = await axios.post(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/join`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        }
      }
    );

    res.json({
      success: true,
      agentId: response.data.agent_id,
      agentUid: agentUid || 2000000 + Math.floor(Math.random() * 1000),
      channel: channel
    });

  } catch (error) {
    console.error('Agora API error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to start conversation',
      details: error.response?.data || error.message
    });
  }
};

const stopConversation = async (req, res) => {
  try {
    const { agentId } = req.params;
    
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    // Check if credentials are configured
    if (!process.env.AGORA_API_KEY || !process.env.AGORA_API_SECRET || !process.env.AGORA_APP_ID) {
      console.log('Agora credentials not configured, simulating stop conversation');
      return res.json({ 
        success: true, 
        message: 'Conversation stopped (demo mode - no API credentials)',
        demo: true
      });
    }

    const auth = Buffer.from(`${process.env.AGORA_API_KEY}:${process.env.AGORA_API_SECRET}`).toString('base64');
    
    const response = await axios.post(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/agents/${agentId}/leave`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        }
      }
    );

    res.json({ success: true, message: 'Conversation stopped ' + response.data.message });

  } catch (error) {
    console.error('Stop conversation error:', error.response?.data || error.message);
    
    // Return success in demo mode to avoid blocking UI
    res.json({ 
      success: true, 
      message: 'Conversation stopped (demo mode - API error handled)',
      error: error.response?.data || error.message,
      demo: true
    });
  }
};

// Helper: build unified RTC + RTM token
function buildUnifiedToken(appId, appCertificate, channel, uid, expirationTimeInSeconds = 3600) {
  const numericUid = parseInt(uid);
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

  const token = new AccessToken2(appId, appCertificate, currentTimestamp, expirationTimeInSeconds);

  const serviceRtc = new ServiceRtc(channel, numericUid);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegeJoinChannel, privilegeExpiredTs);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishAudioStream, privilegeExpiredTs);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishVideoStream, privilegeExpiredTs);
  serviceRtc.add_privilege(ServiceRtc.kPrivilegePublishDataStream, privilegeExpiredTs);
  token.add_service(serviceRtc);

  const serviceRtm = new ServiceRtm(uid.toString());
  serviceRtm.add_privilege(ServiceRtm.kPrivilegeLogin, privilegeExpiredTs);
  token.add_service(serviceRtm);

  return {
    token: token.build(),
    expiresIn: expirationTimeInSeconds
  };
}

module.exports = {
  getChannelInfo,
  startConversation,
  stopConversation
};