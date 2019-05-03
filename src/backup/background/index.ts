// tslint:disable:no-console
import Storex from '@worldbrain/storex'
import Queue, { Options as QueueOpts } from 'queue'

import { makeRemotelyCallable } from '../../util/webextensionRPC'
import { setLocalStorage } from 'src/util/storage'
import { setupRequestInterceptors } from './redirect'
import BackupStorage, { LastBackupStorage } from './storage'
import { BackupBackend } from './backend'
import { BackendSelect } from './backend-select'
import estimateBackupSize from './estimate-backup-size'
import BackupProcedure from './procedures/backup'
import { BackupRestoreProcedure } from './procedures/restore'
import { ProcedureUiCommunication } from 'src/backup/background/procedures/ui-communication'
import NotificationBackground from 'src/notifications/background'
import { DEFAULT_AUTH_SCOPE } from './backend/google-drive'

export * from './backend'

export class BackupBackgroundModule {
    storageManager: Storex
    storage: BackupStorage
    backendLocation: string
    backend: BackupBackend
    lastBackupStorage: LastBackupStorage
    changeTrackingQueue: Queue
    backendSelect = new BackendSelect()
    backupProcedure: BackupProcedure
    backupUiCommunication = new ProcedureUiCommunication('backup-event')
    restoreProcedure: BackupRestoreProcedure
    restoreUiCommunication: ProcedureUiCommunication = new ProcedureUiCommunication(
        'restore-event',
    )

    uiTabId?: any
    automaticBackupCheck?: Promise<boolean>
    automaticBackupTimeout?: any
    automaticBackupEnabled?: boolean
    scheduledAutomaticBackupTimestamp?: number
    notifications: NotificationBackground

    constructor({
        storageManager,
        lastBackupStorage,
        createQueue = Queue,
        queueOpts = { autostart: true, concurrency: 1 },
        notifications,
    }: {
        storageManager: Storex
        lastBackupStorage: LastBackupStorage
        createQueue?: typeof Queue
        queueOpts?: QueueOpts
        notifications: NotificationBackground
    }) {
        this.storageManager = storageManager
        this.storage = new BackupStorage({ storageManager })
        this.lastBackupStorage = lastBackupStorage
        this.changeTrackingQueue = createQueue(queueOpts)
        this.notifications = notifications
    }

    setupRemoteFunctions() {
        makeRemotelyCallable(
            {
                getBackupProviderLoginLink: async (info, params) => {
                    const MEMEX_CLOUD_ORIGIN = _getMemexCloudOrigin()
                    return `${MEMEX_CLOUD_ORIGIN}/auth/google?scope=${DEFAULT_AUTH_SCOPE}`
                },
                startBackup: ({ tab }, params) => {
                    this.backupUiCommunication.registerUiTab(tab)
                    if (this.backupProcedure.running) {
                        return
                    }
                    if (
                        this.restoreProcedure &&
                        this.restoreProcedure.running
                    ) {
                        throw new Error(
                            "Come on, don't be crazy and run backup and restore at once please",
                        )
                    }

                    this.doBackup()
                    this.backupUiCommunication.connect(
                        this.backupProcedure.events,
                    )
                },
                initRestoreProcedure: (info, provider) => {
                    return this.initRestoreProcedure(provider)
                },
                getBackupInfo: () => {
                    return this.backupProcedure.info
                },
                pauseBackup: () => {
                    this.backupProcedure.pause()
                },
                resumeBackup: () => {
                    this.backupProcedure.resume()
                },
                cancelBackup: async () => {
                    await this.backupProcedure.cancel()
                },
                startRestore: async ({ tab }) => {
                    this.restoreUiCommunication.registerUiTab(tab)
                    await this.startRestore()
                },
                getRestoreInfo: async () => {
                    return this.restoreProcedure.info
                },
                pauseRestore: async () => {
                    await this.restoreProcedure.interruptable.pause()
                },
                resumeRestore: async () => {
                    await this.restoreProcedure.interruptable.resume()
                },
                cancelRestore: async () => {
                    await this.restoreProcedure.interruptable.cancel()
                },
                hasInitialBackup: async () => {
                    return !!(await this.lastBackupStorage.getLastBackupTime())
                },
                setBackendLocation: async (info, location?: string) => {
                    if (
                        location === 'google-drive' &&
                        this.backendLocation !== location
                    ) {
                        this.backendLocation = location
                        await this.backendSelect.saveBackendLocation(location)
                        this.backend = await this.backendSelect.initGDriveBackend()
                    } else if (
                        location === 'local' &&
                        this.backendLocation !== location
                    ) {
                        this.backendLocation = location
                        await this.backendSelect.saveBackendLocation(location)
                        this.backend = await this.backendSelect.initLocalBackend()
                    }
                    this.setupRequestInterceptor()
                    this.initBackendDependants()
                },
                getBackendLocation: async info => {
                    this.backendLocation = await this.backendSelect.restoreBackendLocation()
                    return this.backendLocation
                },
                isBackupAuthenticated: async () => {
                    let backend = null
                    /* Check if restoreProcedure's backend is present. 
                        Restore's backend is only present during restore. */
                    backend = this.restoreProcedure
                        ? this.restoreProcedure.backend
                        : this.backend

                    return backend ? backend.isAuthenticated() : false
                },
                maybeCheckAutomaticBakupEnabled: async () => {
                    if (
                        !!(await this.lastBackupStorage.getLastBackupTime()) &&
                        localStorage.getItem('wp.user-id') &&
                        localStorage.getItem('backup.has-subscription') &&
                        localStorage.getItem('nextBackup') === null
                    ) {
                        await this.checkAutomaticBakupEnabled()
                        await this.maybeScheduleAutomaticBackup()
                    }
                },
                checkAutomaticBakupEnabled: async () => {
                    // The only place this is called right now is post-purchase.
                    // Move to more suitable place once this changes.
                    const override =
                        process.env.AUTOMATIC_BACKUP_PAYMENT_SUCCESS
                    if (override && override.length) {
                        console.log(
                            'Automatic backup payment override',
                            override,
                        )
                        this.automaticBackupCheck = Promise.resolve(
                            override === 'true',
                        )
                        // Send a notification stating that the auto backup has expired
                        this.notifications.dispatchNotification(
                            'auto_backup_expired',
                        )
                        // Set the message of backupStatus stating the expiration of auto backup
                        await setLocalStorage('backup-status', {
                            state: 'fail',
                            backupId: 'auto_backup_expired',
                        })
                    } else {
                        await this.checkAutomaticBakupEnabled()
                    }

                    return this.automaticBackupCheck
                },
                isAutomaticBackupEnabled: async () => {
                    return this.isAutomaticBackupEnabled()
                },
                sendNotification: async (id: string) => {
                    const errorId = await this.backend.sendNotificationOnFailure(
                        id,
                        this.notifications,
                        () => this.estimateInitialBackupSize(),
                    )
                    return errorId
                },
                estimateInitialBackupSize: () => {
                    return this.estimateInitialBackupSize()
                },
                setBackupBlobs: (info, saveBlobs) => {
                    localStorage.setItem('backup.save-blobs', saveBlobs)
                },
                getBackupTimes: async () => {
                    return this.getBackupTimes()
                },
                forgetAllChanges: async () => {
                    return this.forgetAllChanges()
                },
                storeWordpressUserId: (info, userId) => {
                    localStorage.setItem('wp.user-id', userId)
                },
                setupRequestInterceptor: () => {
                    return this.setupRequestInterceptor()
                },
            },
            { insertExtraArg: true },
        )
    }

    estimateInitialBackupSize() {
        return estimateBackupSize({
            storageManager: this.storageManager,
        })
    }
    async setBackendFromStorage() {
        this.backend = await this.backendSelect.restoreBackend()
        if (this.backend) {
            this.setupRequestInterceptor()
        }
        this.initBackendDependants()
    }

    initBackendDependants() {
        this.backupProcedure = new BackupProcedure({
            storageManager: this.storageManager,
            storage: this.storage,
            lastBackupStorage: this.lastBackupStorage,
            backend: this.backend,
        })
    }

    async initRestoreProcedure(provider) {
        let backend: BackupBackend = null
        if (provider === 'local') {
            backend = await this.backendSelect.initLocalBackend()
        } else if (provider === 'google-drive') {
            backend = await this.backendSelect.initGDriveBackend()
            this.setupRequestInterceptor(backend)
        }

        this.restoreProcedure = new BackupRestoreProcedure({
            storageManager: this.storageManager,
            storage: this.storage,
            backend,
        })
    }

    resetRestoreProcedure() {
        this.restoreProcedure = null
    }

    setupRequestInterceptor(backupBackend: BackupBackend = null) {
        const backend = backupBackend || this.backend
        setupRequestInterceptors({
            webRequest: window['browser'].webRequest,
            handleLoginRedirectedBack: backend
                ? backend.handleLoginRedirectedBack.bind(backend)
                : null,
            checkAutomaticBakupEnabled: () => this.checkAutomaticBakupEnabled(),
            memexCloudOrigin: _getMemexCloudOrigin(),
        })
    }

    async startRecordingChangesIfNeeded() {
        if (
            !(await this.lastBackupStorage.getLastBackupTime()) ||
            this.storage.recordingChanges
        ) {
            return
        }

        this.storage.startRecordingChanges()
        this.maybeScheduleAutomaticBackup()
    }

    isAutomaticBackupEnabled({ forceCheck = false } = {}) {
        if (!forceCheck && this.automaticBackupCheck) {
            return this.automaticBackupCheck
        }

        const override = process.env.AUTOMATIC_BACKUP
        if (override) {
            console.log('Automatic backup override:', override)
            return override === 'true'
        }

        if (!localStorage.getItem('wp.user-id')) {
            return false
        }

        return this.checkAutomaticBakupEnabled()
    }

    checkAutomaticBakupEnabled() {
        this.automaticBackupCheck = (async () => {
            const wpUserId = localStorage.getItem('wp.user-id')
            if (!wpUserId) {
                return false
            }

            let hasSubscription
            let endDate
            try {
                const subscriptionUrl = `${_getMemexCloudOrigin()}/subscriptions/automatic-backup?user=${wpUserId}`
                const response = await (await fetch(subscriptionUrl)).json()
                hasSubscription = response.active
                endDate = response.endDate
            } catch (e) {
                return true
            }

            localStorage.setItem('backup.has-subscription', hasSubscription)
            if (endDate !== undefined) {
                localStorage.setItem('backup.subscription-end-date', endDate)
            }

            console.log('hasSubscription', hasSubscription)

            return hasSubscription
        })()

        return this.automaticBackupCheck
    }

    async maybeScheduleAutomaticBackup() {
        if (await this.isAutomaticBackupEnabled()) {
            this.scheduleAutomaticBackup()
        }
    }

    scheduleAutomaticBackup() {
        this.automaticBackupEnabled = true
        if (this.automaticBackupTimeout || this.backupProcedure.running) {
            return
        }

        const msUntilNextBackup = 1000 * 60 * 15
        this.scheduledAutomaticBackupTimestamp = Date.now() + msUntilNextBackup
        this.automaticBackupTimeout = setTimeout(() => {
            this.doBackup()
        }, msUntilNextBackup)
    }

    clearAutomaticBackupTimeout() {
        if (this.automaticBackupTimeout) {
            clearTimeout(this.automaticBackupTimeout)
            this.automaticBackupTimeout = null
        }
    }

    async forgetAllChanges() {
        await this.storage.forgetAllChanges()
        await this.lastBackupStorage.removeBackupTimes()
    }

    async getBackupTimes() {
        const lastBackup = await this.lastBackupStorage.getLastBackupFinishTime()
        let nextBackup = null
        if (this.backupProcedure.running) {
            nextBackup = 'running'
        } else if (await this.isAutomaticBackupEnabled()) {
            nextBackup = new Date(this.scheduledAutomaticBackupTimestamp)
        }
        const times = {
            lastBackup: lastBackup && lastBackup.getTime(),
            nextBackup:
                nextBackup && nextBackup.getTime
                    ? nextBackup.getTime()
                    : nextBackup,
        }
        return times
    }

    doBackup() {
        this.clearAutomaticBackupTimeout()

        this.storage.startRecordingChanges()
        this.backupProcedure.run()

        const always = () => {
            this.maybeScheduleAutomaticBackup()
        }
        this.backupProcedure.events.on('success', async () => {
            this.lastBackupStorage.storeLastBackupFinishTime(new Date())
            always()
        })
        this.backupProcedure.events.on('fail', () => {
            always()
        })

        return this.backupProcedure.events
    }

    async prepareRestore() {
        this.clearAutomaticBackupTimeout()
        // await this.lastBackupStorage.storeLastBackupTime(null)

        const runner = this.restoreProcedure.runner()
        this.restoreProcedure.events.once('success', async () => {
            // await this.lastBackupStorage.storeLastBackupTime(new Date())
            await this.startRecordingChangesIfNeeded()
            await this.maybeScheduleAutomaticBackup()
            this.resetRestoreProcedure()
        })

        return runner
    }

    async startRestore({ debug = false } = {}) {
        if (this.restoreProcedure.running) {
            return
        }
        if (this.backupProcedure.running) {
            throw new Error(
                "Come on, don't be crazy and run backup and restore at once please",
            )
        }
        const runner = await this.prepareRestore()
        if (!debug) {
            this.restoreUiCommunication.connect(this.restoreProcedure.events)
        } else {
            this.restoreUiCommunication.connect(
                this.restoreProcedure.events,
                (name, event) => {
                    console.log(`RESTORE DEBUG (${name}):`, event)
                },
            )
        }
        runner()
    }
}

export function _getMemexCloudOrigin() {
    if (
        process.env.NODE_ENV !== 'production' &&
        process.env.LOCAL_AUTH_SERVICE === 'true'
    ) {
        return 'http://localhost:3002'
    } else {
        return 'https://memex.cloud'
    }
}
