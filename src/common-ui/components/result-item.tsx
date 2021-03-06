import React, {
    PureComponent,
    ReactNode,
    MouseEventHandler,
    DragEventHandler,
} from 'react'
import cx from 'classnames'
import AnnotationList from './annotation-list'
import { LoadingIndicator } from 'src/common-ui/components'
import { SocialPage } from 'src/social-integration/types'
import PageResultItem from './page-result-item'
import SocialResultItem from './social-result-item'

const styles = require('./result-item.css')

export interface Props extends Partial<SocialPage> {
    url: string
    title?: string
    favIcon?: string
    nullImg?: string
    screenshot?: string
    displayTime?: string
    isDeleting: boolean
    hasBookmark?: boolean
    isSidebarOpen?: boolean
    isListFilterActive: boolean
    areScreenshotsEnabled?: boolean
    areAnnotationsExpanded?: boolean
    isResponsibleForSidebar?: boolean
    isOverview?: boolean
    isSocial: boolean
    annotations?: any[]
    annotsCount?: number
    tagHolder: ReactNode
    tagManager: ReactNode
    onTagBtnClick: MouseEventHandler
    onTrashBtnClick: MouseEventHandler
    onCommentBtnClick: MouseEventHandler
    onToggleBookmarkClick: MouseEventHandler
    handleCrossRibbonClick: MouseEventHandler
    resetUrlDragged: () => void
    setUrlDragged: (url: string) => void
    setTagButtonRef: (el: HTMLButtonElement) => void
}

class ResultItem extends PureComponent<Props> {
    get hrefToPage() {
        return `http://${this.props.url}`
    }

    get environment() {
        if (this.props.isOverview) {
            return 'overview'
        } else {
            return 'inpage'
        }
    }

    dragStart: DragEventHandler = e => {
        const { url, setUrlDragged } = this.props

        setUrlDragged(url)
        const crt = document.getElementById('dragged-element')
        crt.style.display = 'block'

        e.dataTransfer.setData('text/plain', url)

        e.dataTransfer.setDragImage(crt, 10, 10)
    }

    private renderAnnotsList() {
        if (!(this.props.annotations && this.props.annotations.length)) {
            return null
        }

        return (
            <AnnotationList
                env={this.environment}
                isExpandedOverride={this.props.areAnnotationsExpanded}
                openAnnotationSidebar={this.props.onCommentBtnClick}
                pageUrl={this.hrefToPage}
                annotations={this.props.annotations}
            />
        )
    }

    private handleClickOpenNewTab = (url: string) => (
        e: React.MouseEvent<HTMLDivElement>,
    ) => {
        window.open(url, '_blank').focus()
    }

    render() {
        return (
            <li
                className={cx({
                    [styles.isDeleting]: this.props.isDeleting,
                })}
            >
                {this.props.isDeleting && (
                    <LoadingIndicator className={styles.deletingSpinner} />
                )}
                <div
                    className={cx(styles.rootContainer, {
                        [styles.tweetRootContainer]:
                            this.props.isSocial || this.props.user,
                        [styles.rootContainerOverview]: this.props.isOverview,
                        [styles.isSidebarOpen]: this.props
                            .isResponsibleForSidebar,
                    })}
                >
                    <div
                        onDragStart={this.dragStart}
                        onDragEnd={this.props.resetUrlDragged}
                        className={cx(styles.root, {
                            [styles.rootOverview]: this.props.isOverview,
                        })}
                        onClick={this.handleClickOpenNewTab(this.hrefToPage)}
                        draggable
                    >
                        {this.props.isSocial || this.props.user ? (
                            <SocialResultItem {...this.props} />
                        ) : (
                            <PageResultItem {...this.props} />
                        )}
                    </div>
                </div>
                {this.props.tagManager}
                {this.renderAnnotsList()}
            </li>
        )
    }
}

export default ResultItem
