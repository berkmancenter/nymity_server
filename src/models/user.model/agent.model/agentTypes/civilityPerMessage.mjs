import { ChatOpenAI } from '@langchain/openai'
// eslint-disable-next-line import/no-unresolved
import { isWithinTokenLimit } from 'gpt-tokenizer/esm/model/gpt-4o-mini'
import { AgentMessageActions } from '../../../../types/agent.types.js'
import verify from './verify.mjs'
import formatConvHistory from '../helpers/formatConvHistory.mjs'
import llmChain from '../helpers/llmChain.mjs'
import config from '../../../../config/config.js'

const { getSinglePromptResponse } = llmChain

const llm = new ChatOpenAI(
  {
    apiKey: config.llms.openAI.key,
    model: 'gpt-4o-mini'
  },
  {
    basePath: config.llms.basePath
  }
)

const template = `You are a facilitator in a text-based chat. You consider one message at a time and your only responsibilities are to:
               1) prevent against personal (i.e. ad hominem) attacks.
               2) prevent harassment or bullying against protected classes.
               3) prevent the use of profanity.
               4) do not speak for others, do not make assumptions about how they think or feel. It is ok to reference specific statements they have made.
               5) allow free discussion, consistent points 1-4.
               6) allow participants to share their feelings using any emotion words, only if they reference specific topics(s), statement(s) or experience(s) that have been included or excluded, and are consistent with points 1-4. Unspecific emotional outburst should be prevented.
             Each message starts with participants's username followed by ":" and then the participant's message.
             If there is a problem with a specific message, please respond to the participant by their username (all text before the : character), prefaced with the @ symbol.
             You response should be a professional, simple, compassionate and clear one or two sentence explaining what problem exists with their message, and ask them to rephrase their response and resubmit it.
             Important! If there is no problem with a participants message, you should respond with the specific response "OK".
             Message: {convHistory}
             Answer:`

export default verify({
  name: 'Civility Agent using OpenAI (Per Message)',
  description: 'A basic civility agent using OpenAI to prevent personal or identity based attacks',
  priority: 0,
  maxTokens: 2000,
  // don't include any history
  useNumLastMessages: 0,
  // no min new messages
  minNewMessages: undefined,
  // no timer activation
  timerPeriod: undefined,
  template,
  async initialize() {
    return true
  },
  async evaluate(userMessage) {
    const convHistory = formatConvHistory(this.thread.messages, this.useNumLastMessages, userMessage)
    const topic = this.thread.name
    const llmResponse = await getSinglePromptResponse(llm, template, { convHistory, topic })

    const action = llmResponse === 'OK' ? AgentMessageActions.OK : AgentMessageActions.REJECT

    this.agentEvaluation = {
      userMessage,
      action,
      agentContributionVisible: false,
      userContributionVisible: true,
      suggestion: llmResponse,
      contribution: undefined
    }

    return this.agentEvaluation
  },
  async isWithinTokenLimit(promptText) {
    return isWithinTokenLimit(promptText, this.tokenLimit)
  }
})
