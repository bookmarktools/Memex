import SocialStorage from './storage'
import { StorageManager } from 'src/search/types'
import { makeRemotelyCallable } from 'src/util/webextensionRPC'
import { Tweet, User } from 'src/social-integration/types'
import fetchImage from 'src/social-integration/fetch-image'
const dataURLtoBlob = require('dataurl-to-blob')

export default class SocialBackground {
    private storage: SocialStorage

    constructor({ storageManager }: { storageManager: StorageManager }) {
        this.storage = new SocialStorage({ storageManager })
    }

    setupRemoteFunctions() {
        makeRemotelyCallable({
            addTweet: this.addTweet.bind(this),
            delTweets: this.delTweets.bind(this),
            fetchUserSuggestions: this.fetchUserSuggestions.bind(this),
            fetchAllUsers: this.fetchAllUsers.bind(this),
        })
    }

    async addTweet({ user, ...tweet }: Tweet) {
        await this.addUser(user)
        return this.storage.addTweet(tweet)
    }

    async delTweets(urls: string[]) {
        return this.storage.delTweets(urls)
    }

    async addUser({ profilePicUrl, ...rest }: User) {
        const profilePicURI = await fetchImage(profilePicUrl)
        const profilePic: Blob = profilePicURI
            ? dataURLtoBlob(profilePicURI)
            : undefined

        return this.storage.addUser({
            ...rest,
            profilePic,
        })
    }

    async fetchUserSuggestions({
        name,
        base64Img,
    }: {
        name: string
        base64Img?: boolean
    }) {
        return this.storage.fetchUserSuggestions({ name, base64Img })
    }

    async fetchAllUsers({
        excludeIds = [],
        skip = 0,
        limit = 20,
        base64Img = false,
    }) {
        const query = {
            id: {
                $nin: excludeIds,
            },
        }

        const opts = {
            limit,
            skip,
            base64Img,
        }

        return this.storage.fetchAllUsers({
            query,
            opts,
        })
    }
}
