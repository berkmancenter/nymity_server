const mongoose = require('mongoose')
const setupIntTest = require('../utils/setupIntTest')
const { insertUsers, registeredUser } = require('../fixtures/user.fixture')
const { insertMessages, messageOne } = require('../fixtures/message.fixture')
const userService = require('../../src/services/user.service')

setupIntTest()

const createVote = () => {
  return {
    _id: new mongoose.Types.ObjectId(),
    owner: new mongoose.Types.ObjectId()
  }
}

describe('User service methods', () => {
  describe('goodReputation()', () => {
    beforeEach(() => {
      // Add five upvotes
      messageOne.upVotes = []
      for (let x = 0; x < 5; x++) {
        messageOne.upVotes.push(createVote())
      }
    })

    test('should return true if user vote score < -5 and account is more than 1 week old', async () => {
      // Set created date to > week ago
      const d = new Date()
      d.setDate(d.getDate() - 8)
      registeredUser.createdAt = d.toISOString()
      await insertUsers([registeredUser])
      await insertMessages([messageOne])

      registeredUser.id = registeredUser._id
      const goodReputation = await userService.goodReputation(registeredUser)
      expect(goodReputation).toBe(true)
    })

    test('should return false if user vote score < -5', async () => {
      // Set created date to > week ago
      const d = new Date()
      d.setDate(d.getDate() - 8)
      registeredUser.createdAt = d.toISOString()
      await insertUsers([registeredUser])
      messageOne.downVotes = []
      // Add eleven downvotes
      for (let x = 0; x < 11; x++) {
        messageOne.downVotes.push(createVote())
      }
      await insertMessages([messageOne])
      registeredUser.id = registeredUser._id

      const goodReputation = await userService.goodReputation(registeredUser)
      expect(goodReputation).toBe(false)
    })

    test('should return false if user account is less than one week old', async () => {
      // Set created date to > week ago
      const d = new Date()
      registeredUser.createdAt = d.toISOString()
      await insertUsers([registeredUser])
      await insertMessages([messageOne])
      registeredUser.id = registeredUser._id

      const goodReputation = await userService.goodReputation(registeredUser)
      expect(goodReputation).toBe(false)
    })

    test('should return false if user account is less than one week old user vote score < -5', async () => {
      // Set created date to > week ago
      const d = new Date()
      registeredUser.createdAt = d.toISOString()
      await insertUsers([registeredUser])
      messageOne.downVotes = []
      // Add eleven downvotes
      for (let x = 0; x < 11; x++) {
        messageOne.downVotes.push(createVote())
      }
      await insertMessages([messageOne])
      registeredUser.id = registeredUser._id

      const goodReputation = await userService.goodReputation(registeredUser)
      expect(goodReputation).toBe(false)
    })
  })
})
