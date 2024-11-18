const { ChatOpenAI } = require('@langchain/openai')
// eslint-disable-next-line import/no-unresolved
const { isWithinTokenLimit } = require('gpt-tokenizer/model/gpt-3.5-turbo')
const { AgentMessageActions } = require('../../../../types/agent.types')
const verify = require('./verify')
const formatConvHistory = require('../helpers/formatConvHistory')
const { getSinglePromptResponse } = require('../helpers/llmChain')

const config = require('../../../../config/config')

const llm = new ChatOpenAI(
  {
    apiKey: config.llms.openAI.key
    // can specify model here, default is gpt-3.5.-turbo
  },
  {
    basePath: config.llms.basePath
  }
)

const template = `You are a playful discussion facilitator who can suggest discussion questions based only on the topic provided and the conversation history.
             Always speak as if you were chatting to a friend in a playful and mischievious manner.
             Address your question to a specific discussion participant other than yourself (the user known as AI) and preface the partcipant's name with the @ symbol.
             Make sure your question is unique from prior questions you have asked.
             Topic: {topic}
             Conversation history: {convHistory}
             Answer:`
module.exports = verify({
  name: 'Playful Agent (Periodic)',
  description: 'A playful agent to lighten up a conversation!',
  maxTokens: 2000,
  useNumLastMessages: 20,
  minNewMessages: 2,
  timerPeriod: '30 seconds',
  async initialize() {
    return true
  },
  async evaluate(userMessage) {
    return {
      userMessage,
      action: AgentMessageActions.CONTRIBUTE,
      userContributionVisible: true,
      suggestion: undefined
    }
  },

  // eslint-disable-next-line class-methods-use-this
  async isWithinTokenLimit(promptText) {
    return isWithinTokenLimit(promptText, this.tokenLimit)
  },

  async respond(userMessage) {
    const convHistory = formatConvHistory(this.thread.messages, this.useNumLastMessages, userMessage)
    const topic = this.thread.name
    const llmResponse = await getSinglePromptResponse(llm, template, { convHistory, topic })

    const agentResponse = {
      visible: true,
      message: llmResponse
    }

    return [agentResponse]
  }
})
