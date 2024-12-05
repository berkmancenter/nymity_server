const faker = require('faker')
const mongoose = require('mongoose')
// This has to be mocked before setupIntTest uses it
jest.mock('agenda')
const agenda = require('../../src/agenda')
const setupIntTest = require('../utils/setupIntTest')
const waitFor = require('../utils/waitFor')
const { Message, Thread } = require('../../src/models/index')
const { registeredUser, insertUsers } = require('../fixtures/user.fixture')
const { publicTopic, threadAgentsEnabled } = require('../fixtures/thread.fixture')
const { insertTopics } = require('../fixtures/topic.fixture')
const { AgentMessageActions } = require('../../src/types/agent.types')

jest.mock('../../src/websockets/socketIO', () => ({
  connection: jest.fn(() => ({
    emit: jest.fn()
  }))
}))

const { connection } = require('../../src/websockets/socketIO')

const mockEvaluate = jest.fn()
const mockRespond = jest.fn()
const mockTokenLimit = jest.fn()
const mockInitialize = jest.fn()

jest.unstable_mockModule('../../src/models/user.model/agent.model/agentTypes/index.mjs', () => ({
  default: {
    'test-type': {
      initialize: mockInitialize,
      respond: mockRespond,
      evaluate: mockEvaluate,
      isWithinTokenLimit: mockTokenLimit,
      name: 'Test Agent',
      description: 'A periodic test agent',
      maxTokens: 2000,
      useNumLastMessages: 20,
      minNewMessages: 2,
      timerPeriod: '30 seconds'
    }
  }
}))

setupIntTest()

let agent
let thread
let msg1
let msg2
let msg3
let Agent

describe('agent tests', () => {
  beforeAll(async () => {
    const module = await import('../../src/models/user.model/agent.model/index.mjs')
    Agent = module.default
  })
  beforeEach(async () => {
    await insertUsers([registeredUser])
    await insertTopics([publicTopic])

    thread = new Thread(threadAgentsEnabled)
    thread.save()

    agent = new Agent({
      agentType: 'test-type',
      thread
    })
    await agent.save()

    msg1 = new Message({
      _id: mongoose.Types.ObjectId(),
      body: faker.lorem.words(10),
      thread: threadAgentsEnabled._id,
      owner: registeredUser._id,
      pseudonymId: registeredUser.pseudonyms[0]._id,
      pseudonym: registeredUser.pseudonyms[0].pseudonym
    })
    msg2 = new Message({
      _id: mongoose.Types.ObjectId(),
      body: faker.lorem.words(10),
      thread: threadAgentsEnabled._id,
      owner: registeredUser._id,
      pseudonymId: registeredUser.pseudonyms[0]._id,
      pseudonym: registeredUser.pseudonyms[0].pseudonym
    })
    msg3 = new Message({
      _id: mongoose.Types.ObjectId(),
      body: faker.lorem.words(10),
      thread: threadAgentsEnabled._id,
      owner: registeredUser._id,
      pseudonymId: registeredUser.pseudonyms[0]._id,
      pseudonym: registeredUser.pseudonyms[0].pseudonym
    })
  })
  afterEach(async () => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  test('should generate an AI response when min messages received from users', async () => {
    await agent.initialize()
    expect(agenda.start).toHaveBeenCalled()
    expect(agenda.every).toHaveBeenCalledWith(agent.timerPeriod, agent.agendaJobName, { agentId: agent._id })
    expect(mockInitialize).toHaveBeenCalled()
    agent.thread = thread
    const evaluation = await agent.evaluate(msg1)

    expect(evaluation).toEqual({ action: AgentMessageActions.OK, userContributionVisible: true })

    // User message is persisted after agent is called and gives the OK
    await msg1.save()
    thread.messages.push(msg1.toObject())
    await thread.save()
    await thread.populate('messages').execPopulate()

    agent.thread = thread

    const expectedEval = {
      userMessage: msg2,
      action: AgentMessageActions.CONTRIBUTE,
      agentContributionVisible: true,
      userContributionVisible: true,
      suggestion: undefined
    }

    const expectedResponse = {
      visible: true,
      message: 'A response'
    }

    mockEvaluate.mockResolvedValue(expectedEval)
    mockRespond.mockResolvedValue([expectedResponse])
    const evaluation2 = await agent.evaluate(msg2)
    expect(evaluation2).toEqual(expectedEval)

    // verify timer was reset since agent processed messages
    expect(agenda.cancel).toHaveBeenCalledWith({ name: agent.agendaJobName })
    expect(agenda.every).toHaveBeenCalledTimes(2)

    // verify async response
    await waitFor(async () => {
      const agentMessage = await Message.findOne({ fromAgent: true }).select('body count').exec()
      if (agentMessage == null) throw Error('Agent message not found')
      expect(agentMessage.body).toBe('A response')
      expect(connection).toHaveBeenCalled()
      const emitMock = connection.mock.results[0].value.emit
      expect(emitMock).toHaveBeenCalledWith(
        thread._id.toString(),
        'message:new',
        expect.objectContaining({ body: 'A response', count: 2 })
      )
    })

    await msg2.save()
    thread.messages.push(msg2.toObject())
    await thread.save()
    await thread.populate('messages').execPopulate()

    // 2 user messages and one agent message processed at this point, but agent message should not count in calculation
    agent.thread = thread
    const evaluation3 = await agent.evaluate(msg3)
    expect(evaluation3).toEqual({ action: AgentMessageActions.OK, userContributionVisible: true })
    expect(agent.lastActiveMessageCount).toEqual(2)
  })

  test('should generate an AI response when any messages received since last periodic check', async () => {
    await agent.initialize()
    expect(agenda.start).toHaveBeenCalled()
    expect(agenda.every).toHaveBeenCalledWith(agent.timerPeriod, agent.agendaJobName, { agentId: agent._id })
    expect(mockInitialize).toHaveBeenCalled()

    await msg1.save()
    thread.messages.push(msg1.toObject())
    await thread.save()
    await thread.populate('messages').execPopulate()

    const expectedEval = {
      userMessage: null,
      action: AgentMessageActions.CONTRIBUTE,
      agentContributionVisible: true,
      userContributionVisible: true,
      suggestion: undefined
    }

    const expectedResponse = {
      visible: true,
      message: 'Another response'
    }
    mockEvaluate.mockResolvedValue(expectedEval)
    mockRespond.mockResolvedValue([expectedResponse])
    const evaluation = await agent.evaluate()
    expect(evaluation).toEqual(expectedEval)

    // verify async response
    await waitFor(async () => {
      const agentMessage = await Message.findOne({ fromAgent: true }).select('body count').exec()
      if (agentMessage == null) throw Error('Agent message not found')
      expect(agentMessage.body).toBe('Another response')
      expect(connection).toHaveBeenCalled()
      const emitMock = connection.mock.results[0].value.emit
      expect(emitMock).toHaveBeenCalledWith(
        thread._id.toString(),
        'message:new',
        expect.objectContaining({ body: 'Another response', count: 2 })
      )
    })

    // verify timer was not reset
    expect(agenda.every).toHaveBeenCalledTimes(1)
  })

  test('should indicate if input text is within max token limit', async () => {
    mockTokenLimit.mockResolvedValue(true)

    await agent.initialize()

    const inLimit = await agent.isWithinTokenLimit('Hello')
    expect(inLimit).toBe(true)
  })
})