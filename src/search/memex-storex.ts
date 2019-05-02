import stemmer from '@worldbrain/memex-stemmer'

import UrlField from './storage/url-field'
import schemaPatcher from './storage/dexie-schema'
import collections from './old-schema'
import initStorex from './storex'
import { StorageManager } from './types'
import { plugins } from './storex-plugins'

export default () =>
    initStorex<StorageManager>({
        stemmer,
        collections,
        schemaPatcher,
        dbName: 'memex',
        customFields: [{ key: 'url', field: UrlField }],
        backendPlugins: plugins,
        idbImplementation: {
            factory: window.indexedDB,
            range: IDBKeyRange,
        },
    })
