const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { topicService, userService } = require('../services');

const createTopic = catchAsync(async (req, res) => {
  const topic = await topicService.createTopic(req.body, req.user);
  res.status(httpStatus.CREATED).send(topic);
});

const userTopics = catchAsync(async (req, res) => {
  const topics = await topicService.userTopics(req.user);
  res.status(httpStatus.OK).send(topics);
});

const getTopic = catchAsync(async (req, res) => {
  const topic = await topicService.findById(req.params.topicId);
  res.status(httpStatus.OK).send(topic);
});

const allTopics = catchAsync(async (req, res) => {
  const topics = await topicService.allTopics(req.user);
  res.status(httpStatus.OK).send(topics);
});

const publicTopics = catchAsync(async (req, res) => {
  if (userService.isTokenGeneratedByThreads(req.params.token) === false) {
    throw new Error('Invalid token');
  }
  const topics = await topicService.allTopics();
  // Return top ten topics
  res.status(httpStatus.OK).send(topics.slice(0,10));
});

module.exports = {
  createTopic,
  userTopics,
  getTopic,
  allTopics,
  publicTopics,
};
