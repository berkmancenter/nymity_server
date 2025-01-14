const faker = require('faker')
const mongoose = require('mongoose')
// This has to be mocked before setupIntTest uses it
jest.mock('agenda')
const agenda = require('../../src/agenda')
const setupIntTest = require('../utils/setupIntTest')
const waitFor = require('../utils/waitFor')
const config = require('../../src/config/config')
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
const mockInitialize = jest.fn()
const mockTokenLimit = jest.fn()

jest.unstable_mockModule('../../src/models/user.model/agent.model/agentTypes/index.mjs', () => ({
  default: {
    perMessageWithMin: {
      initialize: mockInitialize,
      respond: mockRespond,
      evaluate: mockEvaluate,
      isWithinTokenLimit: mockTokenLimit,
      name: 'Test Per Message Min',
      description: 'An agent that responds per message after a certain number reached',
      maxTokens: 2000,
      useNumLastMessages: 20,
      minNewMessages: 2,
      timerPeriod: undefined,
      priority: 100
    },
    periodic: {
      initialize: mockInitialize,
      respond: mockRespond,
      evaluate: mockEvaluate,
      isWithinTokenLimit: mockTokenLimit,
      name: 'Test Periodic',
      description: 'An agent that responds only periodically with no min messages',
      maxTokens: 2000,
      useNumLastMessages: 20,
      minNewMessages: 2,
      timerPeriod: '30 seconds',
      priority: 200,
      introMessage: 'Hello there'
    },
    periodicNoMin: {
      initialize: mockInitialize,
      respond: mockRespond,
      evaluate: mockEvaluate,
      isWithinTokenLimit: mockTokenLimit,
      name: 'Test Periodic',
      description: 'An agent that responds only periodically with no min messages',
      maxTokens: 2000,
      useNumLastMessages: 20,
      minNewMessages: undefined,
      timerPeriod: '30 seconds',
      priority: 200
    },
    perMessage: {
      initialize: mockInitialize,
      respond: mockRespond,
      evaluate: mockEvaluate,
      isWithinTokenLimit: mockTokenLimit,
      name: 'Test Per Message',
      description: 'An agent that responds to every message',
      maxTokens: 2000,
      useNumLastMessages: 0,
      minNewMessages: undefined,
      timerPeriod: undefined,
      priority: 10
    }
  }
}))

setupIntTest()

let thread
let msg1
let msg2
let msg3
let Agent
;(config.enableAgents ? describe : describe.skip)('agent tests', () => {
  beforeAll(async () => {
    const module = await import('../../src/models/user.model/agent.model/index.mjs')
    Agent = module.default
  })
  beforeEach(async () => {
    await insertUsers([registeredUser])
    await insertTopics([publicTopic])

    thread = new Thread(threadAgentsEnabled)
    await thread.save()

    msg1 = new Message({
      _id: new mongoose.Types.ObjectId(),
      body: faker.lorem.words(10),
      thread: threadAgentsEnabled._id,
      owner: registeredUser._id,
      pseudonymId: registeredUser.pseudonyms[0]._id,
      pseudonym: registeredUser.pseudonyms[0].pseudonym
    })
    msg2 = new Message({
      _id: new mongoose.Types.ObjectId(),
      body: faker.lorem.words(10),
      thread: threadAgentsEnabled._id,
      owner: registeredUser._id,
      pseudonymId: registeredUser.pseudonyms[0]._id,
      pseudonym: registeredUser.pseudonyms[0].pseudonym
    })
    msg3 = new Message({
      _id: new mongoose.Types.ObjectId(),
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
    const agent = new Agent({
      agentType: 'perMessageWithMin',
      thread
    })
    await agent.save()
    await agent.initialize()
    // ensure agenda was not started
    expect(agenda.start).not.toHaveBeenCalled()
    expect(agenda.every).not.toHaveBeenCalled()
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

  test('should generate an intro message when specified', async () => {
    const agent = new Agent({
      agentType: 'periodic',
      thread
    })
    await agent.save()
    await agent.initialize(true)
    // ensure agenda was started
    expect(agenda.start).toHaveBeenCalled()
    expect(agenda.every).toHaveBeenCalled()
    expect(mockInitialize).toHaveBeenCalled()
    const expectedMessage = {
      fromAgent: true,
      visible: true,
      body: agent.introMessage,
      thread: thread._id,
      pseudonym: agent.name,
      pseudonymId: agent.pseudonyms[0]._id,
      owner: agent._id
    }
    await thread.populate('messages').execPopulate()
    const agentMessages = thread.messages.filter((msg) => msg.fromAgent && msg.visible)
    expect(agentMessages.length).toBe(1)
    expect(agentMessages).toContainEqual(expect.objectContaining(expectedMessage))
  })

  test('should generate an AI response when any messages received since last periodic check', async () => {
    const agent = new Agent({
      agentType: 'periodic',
      thread
    })
    await agent.initialize()
    expect(agenda.start).toHaveBeenCalled()
    expect(agenda.every).toHaveBeenCalledWith(
      agent.timerPeriod,
      agent.agendaJobName,
      { agentId: agent._id },
      { skipImmediate: true }
    )
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
        expect.objectContaining({ body: 'Another response', count: 2, pause: undefined })
      )
    })
  })

  test('should allow agent to evaluate when no messages received since last periodic check if minNewMessages undefined', async () => {
    const agent = new Agent({
      agentType: 'periodicNoMin',
      thread
    })
    await agent.initialize()
    expect(agenda.start).toHaveBeenCalled()
    expect(agenda.every).toHaveBeenCalledWith(
      agent.timerPeriod,
      agent.agendaJobName,
      { agentId: agent._id },
      { skipImmediate: true }
    )
    expect(mockInitialize).toHaveBeenCalled()

    mockEvaluate.mockResolvedValue({
      action: AgentMessageActions.OK,
      userContributionVisible: true,
      userMessage: null,
      suggestion: undefined
    })
    await agent.evaluate()
    expect(mockEvaluate).toHaveBeenCalled()
    expect(mockRespond).not.toHaveBeenCalled()
  })

  test('should not increase messsage count if message rejected', async () => {
    const agent = new Agent({
      agentType: 'perMessage',
      thread
    })
    await agent.initialize()
    expect(agenda.start).not.toHaveBeenCalled()
    expect(agenda.every).not.toHaveBeenCalled()
    expect(mockInitialize).toHaveBeenCalled()

    const expectedEval = {
      userMessage: msg1,
      action: AgentMessageActions.REJECT,
      agentContributionVisible: false,
      userContributionVisible: true,
      suggestion: 'Be nicer',
      contribution: undefined
    }

    mockEvaluate.mockResolvedValue(expectedEval)
    agent.thread = thread
    const evaluation = await agent.evaluate(msg1)
    expect(evaluation).toEqual(expectedEval)
    expect(agent.lastActiveMessageCount).toBe(0)

    expect(mockRespond).not.toHaveBeenCalled()
  })

  test('should indicate if input text is within max token limit', async () => {
    const agent = new Agent({
      agentType: 'perMessage',
      thread
    })
    mockTokenLimit.mockResolvedValue(true)

    await agent.initialize()

    const inLimit = await agent.isWithinTokenLimit('Hello')
    expect(inLimit).toBe(true)
  })
})
