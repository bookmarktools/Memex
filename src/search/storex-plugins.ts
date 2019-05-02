import {
    DexieUtilsPlugin,
    SearchLookbacksPlugin,
    SuggestPlugin,
} from 'src/search/plugins'
import { AnnotationsListPlugin } from 'src/search/background/annots-list'
import { PageUrlMapperPlugin } from 'src/search/background/page-url-mapper'

export const plugins = [
    new AnnotationsListPlugin(),
    new PageUrlMapperPlugin(),
    new SuggestPlugin(),
    new DexieUtilsPlugin(),
    new SearchLookbacksPlugin(),
]
