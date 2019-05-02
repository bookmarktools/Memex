import stemmer from '@worldbrain/memex-stemmer'
import inMemoryDb from '@worldbrain/storex-backend-dexie/lib/in-memory'

import UrlField from './storage/url-field'
import schemaPatcher from './storage/dexie-schema'
import collections from './old-schema'
import initStorex from './storex'
import { plugins } from './storex-plugins'

export default () =>
    initStorex({
        stemmer,
        collections,
        schemaPatcher,
        dbName: 'test',
        customFields: [{ key: 'url', field: UrlField }],
        backendPlugins: plugins,
        idbImplementation: inMemoryDb(),
    })
