import { Dexie, SearchParams, PageResultsMap, FilteredURLs } from '..'

/**
 * Given some URLs, grab the latest assoc. event timestamp for each one within the time filter bounds.
 */
export const mapUrlsToLatestEvents = (getDb: () => Promise<Dexie>) => async (
    { endDate, startDate, bookmarks }: Partial<SearchParams>,
    urls: string[],
) => {
    const db = await getDb()

    /**
     * @param {PageResultsMap} urlTimeMap Map to keep track of URL-timestamp pairs.
     * @param {boolean} [skipDateCheck=false] Flag to denote whether to skip start/end date boundary checking.
     * @returns A function that looks at each URL-timestamp pair and decides if should keep track or not.
     */
    function attemptAdd(urlTimeMap: PageResultsMap, skipDateCheck = false) {
        return (time: number, url: string) => {
            const existing = urlTimeMap.get(url) || 0

            if (
                existing > time ||
                (!skipDateCheck && endDate != null && endDate < time) ||
                (!skipDateCheck && startDate != null && startDate > time)
            ) {
                return false
            }

            urlTimeMap.set(url, time)
            return true
        }
    }

    const latestBookmarks: PageResultsMap = new Map()
    await db.bookmarks
        .where('url')
        .anyOf(urls)
        .each(({ time, url }) =>
            attemptAdd(latestBookmarks, bookmarks)(time, url),
        )

    const latestVisits: PageResultsMap = new Map()
    const urlsToCheck = bookmarks ? [...latestBookmarks.keys()] : urls
    // Simple state to keep track of when to finish each query
    const doneFlags = urlsToCheck.map(url => false)

    const visits = await db.visits
        .where('url')
        .anyOf(urlsToCheck)
        .reverse()
        .primaryKeys()

    const visitsPerPage = new Map<string, number[]>()
    visits.forEach(([time, url]) => {
        const current = visitsPerPage.get(url) || []
        visitsPerPage.set(url, [...current, time])
    })

    urlsToCheck.forEach((url, i) => {
        const currVisits = visitsPerPage.get(url) || []
        // `currVisits` array assumed sorted latest first
        currVisits.forEach(visit => {
            if (doneFlags[i]) {
                return
            }

            doneFlags[i] = attemptAdd(latestVisits)(visit, url)
        })
    })

    // Merge results
    const latestEvents: PageResultsMap = new Map()
    latestVisits.forEach(attemptAdd(latestEvents))
    latestBookmarks.forEach(attemptAdd(latestEvents))

    return latestEvents
}

/**
 * @return Map of URL keys to latest visit time numbers. Should be size <= skip + limit.
 */
export const groupLatestEventsByUrl = (getDb: () => Promise<Dexie>) => (
    params: Partial<SearchParams>,
    filteredUrls: FilteredURLs,
) => {
    return params.bookmarks
        ? lookbackBookmarksTime(getDb)(params)
        : lookbackFromEndDate(getDb)(params, filteredUrls)
}

/**
 * Goes through visits and bookmarks index from `endDate` until it groups enough URLs.
 * The `.until` in the query chain forces time and space to be constant to `skip + limit`
 */
const lookbackFromEndDate = (getDb: () => Promise<Dexie>) => async (
    {
        startDate = 0,
        endDate = Date.now(),
        skip = 0,
        limit = 10,
    }: Partial<SearchParams>,
    filteredUrls: FilteredURLs,
) => {
    const db = await getDb()
    // Lookback from endDate to get needed amount of visits
    const latestVisits: PageResultsMap = new Map()
    await db.visits
        .where('[time+url]')
        .between(
            [startDate, ''],
            [endDate, String.fromCharCode(65535)],
            true,
            true,
        )
        // Go through visits by most recent
        .reverse()
        // Stop iterating once we have enough
        .until(() => latestVisits.size >= skip + limit)
        // For each visit PK, reduce down into Map of URL keys to latest visit time
        .each(({ time, url, pageType }) => {
            // Only ever record the latest visit for each URL (first due to IndexedDB reverse keys ordering)
            if (
                pageType !== 'social' &&
                !latestVisits.has(url) &&
                filteredUrls.isAllowed(url)
            ) {
                latestVisits.set(url, time)
            }
        })

    // Similar lookback on bookmarks
    const latestBookmarks: PageResultsMap = new Map()
    await db.bookmarks
        .where('time')
        .between(startDate, endDate, true, true)
        .reverse()
        .until(() => latestBookmarks.size >= skip + limit)
        .each(({ time, url, pageType }) => {
            if (pageType !== 'social') {
                latestBookmarks.set(url, time)
            }
        })

    // Merge results
    const results: PageResultsMap = new Map()
    const addToMap = (time, url) => {
        const existing = results.get(url) || 0
        if (existing < time) {
            results.set(url, time)
        }
    }
    latestVisits.forEach(addToMap)
    latestBookmarks.forEach(addToMap)

    return results
}

/**
 * Goes through bookmarks index from latest time until it groups enough URLs that have either been
 * bookmarked OR visited within the bounds specified in the search params.
 */
const lookbackBookmarksTime = (getDb: () => Promise<Dexie>) => async ({
    startDate = 0,
    endDate = Date.now(),
    skip = 0,
    limit = 10,
}: Partial<SearchParams>) => {
    const db = await getDb()
    let bmsExhausted = false
    let results: PageResultsMap = new Map()

    // Start looking back from latest time, then update upper bound to the latest result time each iteration
    let upperBound = Date.now()

    // Stop lookback when we have enough results or no more bookmarks
    while (results.size < skip + limit && !bmsExhausted) {
        const bms: PageResultsMap = new Map()

        // Grab latest page of bookmarks
        await db.bookmarks
            .where('time')
            .belowOrEqual(upperBound)
            .reverse() // Latest first
            .until(() => bms.size >= skip + limit)
            .each(({ time, url, pageType }) => {
                if (pageType !== 'social') {
                    bms.set(url, time)
                }
            })

        if (bms.size < skip + limit) {
            bmsExhausted = true
        }

        // For each one, if was bookmarked later than endDate filter, replace with latest in-bounds visit
        await Promise.all(
            [...bms].map(async ([currentUrl, currentTime]) => {
                if (currentTime > endDate || currentTime < startDate) {
                    let done = false
                    await db.visits
                        .where('url')
                        .equals(currentUrl)
                        .reverse()
                        .until(() => done)
                        .eachPrimaryKey(([visitTime]) => {
                            if (
                                visitTime >= startDate &&
                                visitTime <= endDate
                            ) {
                                bms.set(currentUrl, visitTime)
                                done = true
                            }
                        })
                }
            }),
        )

        // Next iteration, look back from the oldest result's time (-1 to exclude the same result next time)
        upperBound = Math.min(...bms.values()) - 1

        // Add current iteration's bm results to result pool, filtering out any out-of-bounds bms
        results = new Map([
            ...results,
            ...[...bms].filter(
                ([, time]) => time >= startDate && time <= endDate,
            ),
        ])
    }

    return results
}
