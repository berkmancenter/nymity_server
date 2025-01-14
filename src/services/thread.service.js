const mongoose = require('mongoose')
const httpStatus = require('http-status')
const { Thread, Topic, Follower, Message } = require('../models')
const updateDocument = require('../utils/updateDocument')
const ApiError = require('../utils/ApiError')

const returnFields = 'name slug locked owner createdAt'

/**
 * Removed messages array property and replaces with messageCount
 * @param {Array} threads
 * @returns {Array}
 */
const addMessageCount = (threads) => {
  return threads.map((thread) => {
    const t = thread.toObject()

    t.messageCount = t.messages ? t.messages.reduce((count, msg) => count + (msg.visible ? 1 : 0), 0) : 0
    delete t.messages
    // Replace _id with id since toJSON plugin will not be applied
    t.id = t._id.toString()
    delete t._id
    return t
  })
}

/**
 * Create a thread
 * @param {Object} threadBody
 * @returns {Promise<Thread>}
 */
const createThread = async (threadBody, user) => {
  if (!threadBody.topicId) throw new ApiError(httpStatus.BAD_REQUEST, 'topic id must be passed in request body')

  const topicId = mongoose.Types.ObjectId(threadBody.topicId)
  const topic = await Topic.findById(topicId)

  if (!topic.threadCreationAllowed && user._id.toString() !== topic.owner.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Thread creation not allowed.')
  }

  const thread = await Thread.create({
    name: threadBody.name,
    owner: user,
    topic,
    enableAgents: !!threadBody.agentTypes.length,
    agents: []
  })

  // need to save to get id
  await thread.save()

  const { default: Agent } = await import('../models/user.model/agent.model/index.mjs')
  for (const agentType of threadBody.agentTypes) {
    const agent = new Agent({
      agentType,
      thread
    })

    // need to save to get id
    await agent.save()

    // initialize to set up timer, etc.
    await agent.initialize(true)

    // depopulate thread to prevent circular clone
    agent.thread = thread._id
    thread.agents.push(agent)
  }

  topic.threads.push(thread.toObject())
  await Promise.all([thread.save(), topic.save()])

  return thread
}

/**
 * Update a thread
 * @param {Object} threadBody
 * @returns {Promise<Thread>}
 */
const updateThread = async (threadBody, user) => {
  let threadDoc = await Thread.findById(threadBody.id).populate('topic')
  if (user._id.toString() !== threadDoc.owner.toString() && user._id.toString() !== threadDoc.topic.owner.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only thread or topic owner can update.')
  }

  threadDoc = updateDocument(threadBody, threadDoc)
  await threadDoc.save()

  return threadDoc
}

const userThreads = async (user) => {
  const deletedTopics = await Topic.find({ isDeleted: true }).select('_id')
  const followedThreads = await Follower.find({ user }).select('thread').exec()
  const followedThreadsIds = followedThreads.map((el) => el.thread).filter((el) => el)
  let threads = await Thread.find({
    $and: [
      { $or: [{ owner: user }, { _id: { $in: followedThreadsIds } }] },
      {
        topic: { $nin: deletedTopics }
      }
    ]
  })
    .populate({ path: 'messages', select: 'id visible' })
    .select(returnFields)
    .exec()
  threads = addMessageCount(threads)
  threads.forEach((thread) => {
    if (followedThreadsIds.map((f) => f.toString()).includes(thread.id)) {
      // eslint-disable-next-line
      thread.followed = true
    }
  })
  return threads
}

const findById = async (id) => {
  const thread = await Thread.findOne({ _id: id }).populate('followers').select('name slug owner').exec()
  return thread
}

const findByIdFull = async (id, user) => {
  const thread = await Thread.findOne({ _id: id }).select(returnFields).exec()
  const threadPojo = thread.toObject()
  threadPojo.followed = await Follower.findOne({ thread, user }).select('_id').exec()

  threadPojo.id = threadPojo._id.toString()
  delete threadPojo._id
  return threadPojo
}

const topicThreads = async (topicId) => {
  const threads = await Thread.find({ topic: topicId })
    .populate({ path: 'messages', select: 'id visible' })
    .select(returnFields)
    .exec()
  return addMessageCount(threads)
}

const follow = async (status, threadId, user) => {
  const thread = await findById(threadId)
  const params = {
    user,
    thread
  }

  if (status === true) {
    const follower = await Follower.create(params)

    thread.followers.push(follower.toObject())
    thread.save()
  } else {
    await Follower.deleteMany(params)
  }
}

const allPublic = async () => {
  const deletedTopics = await Topic.find({ isDeleted: true }).select('_id')
  const threads = await Thread.find({ topic: { $nin: deletedTopics } })
    .select(returnFields)
    .populate({ path: 'messages', select: 'id visible' })
    .exec()
  return addMessageCount(threads)
}

const deleteThread = async (id, user) => {
  const thread = await Thread.findOne({ _id: id }).populate('topic').select('name slug owner topic').exec()

  if (user._id.toString() !== thread.owner.toString() && user._id.toString() !== thread.topic.owner.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only thread or topic owner can delete.')
  }

  await Thread.deleteOne({ _id: id })
  await Follower.deleteMany({ thread })
  await Message.deleteMany({ thread })
}

module.exports = {
  createThread,
  userThreads,
  findById,
  topicThreads,
  follow,
  findByIdFull,
  allPublic,
  deleteThread,
  updateThread
}
