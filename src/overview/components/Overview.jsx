import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import Waypoint from 'react-waypoint'

import * as actions from '../actions'
import * as selectors from '../selectors'
import * as constants from '../constants'
import ResultList from './ResultList'
import DateRangeSelection from './DateRangeSelection'
import DeleteConfirmation from './DeleteConfirmation'
import PageResultItem from './PageResultItem'
import { LoadingIndicator } from 'src/common-ui/components'
import styles from './Overview.css'


class Overview extends React.Component {
    componentDidMount() {
        if (this.props.grabFocusOnMount) {
            this.inputQueryEl.focus()
        }
    }

    handleInputChange = e => this.props.onInputChanged(e.target.value)

    renderResultItems() {
        const { searchResults, onBottomReached, isLoading, needsWaypoint } = this.props

        const resultItems = searchResults.map(doc => (
            <li key={doc._id}>
                <PageResultItem
                    doc={doc}
                    sizeInMB={doc.freezeDrySize}
                    isBookmark={doc.displayType === constants.RESULT_TYPES.BOOKMARK}
                />
            </li>
        ))

        // Insert waypoint at the end of results to trigger loading new items when scrolling down
        if (needsWaypoint) {
            resultItems.push(<Waypoint onEnter={onBottomReached} key='waypoint' />)
        }

        // Add loading spinner to the list end, if loading (may change this)
        if (isLoading) {
            resultItems.push(<LoadingIndicator key='loading' />)
        }

        return resultItems
    }

    renderNoResultsMsg() {
        return <p className={styles.noResultMessage}>No results</p>
    }

    render() {
        const { query, startDate, endDate } = this.props.currentQueryParams

        return (
            <div>
                <div className={styles.navbar}>
                    <div className={styles.logo} />
                    <div className={styles.searchField}>
                        <input
                            className={styles.query}
                            onChange={this.handleInputChange}
                            placeholder='Search your memory'
                            value={query}
                            ref={ref => { this.inputQueryEl = ref }}
                        />
                        <DateRangeSelection
                            startDate={startDate}
                            endDate={endDate}
                            onStartDateChange={this.props.onStartDateChange}
                            onEndDateChange={this.props.onEndDateChange}
                        />
                    </div>
                    <div className={styles.links}>
                        <a href='/options/options.html'>
                            <img
                                src='/img/settings-icon.png'
                                className={styles.icon}
                            />
                        </a>
                    </div>
                </div>

                <div className={styles.main}>
                    {this.props.noResults
                        ? this.renderNoResultsMsg()
                        : <ResultList>{this.renderResultItems()}</ResultList>}
                    <DeleteConfirmation
                        isShown={this.props.isDeleteConfShown}
                        close={this.props.hideDeleteConfirm}
                        deleteAll={this.props.deleteAssociatedDocs(this.props.metaDocToDelete)}
                        deleteMeta={this.props.deleteMeta(this.props.metaDocToDelete)}
                    />
                </div>
            </div>
        )
    }
}

Overview.propTypes = {
    grabFocusOnMount: PropTypes.bool,
    currentQueryParams: PropTypes.shape({
        query: PropTypes.string,
        startDate: PropTypes.number,
        endDate: PropTypes.number,
    }).isRequired,
    onInputChanged: PropTypes.func,
    onStartDateChange: PropTypes.func,
    onEndDateChange: PropTypes.func,
    onBottomReached: PropTypes.func,
    isLoading: PropTypes.bool,
    noResults: PropTypes.bool.isRequired,
    searchResults: PropTypes.arrayOf(PropTypes.object).isRequired,
    isDeleteConfShown: PropTypes.bool.isRequired,
    metaDocToDelete: PropTypes.object,
    hideDeleteConfirm: PropTypes.func.isRequired,
    deleteAssociatedDocs: PropTypes.func.isRequired,
    deleteMeta: PropTypes.func.isRequired,
    needsWaypoint: PropTypes.bool.isRequired,
}

const mapStateToProps = state => ({
    isLoading: selectors.isLoading(state),
    currentQueryParams: selectors.currentQueryParams(state),
    noResults: selectors.noResults(state),
    searchResults: selectors.results(state),
    isDeleteConfShown: selectors.isDeleteConfShown(state),
    metaDocToDelete: selectors.metaDocToDelete(state),
    needsWaypoint: selectors.needsPagWaypoint(state),
})

const mapDispatchToProps = dispatch => ({
    ...bindActionCreators({
        onInputChanged: actions.setQuery,
        onStartDateChange: actions.setStartDate,
        onEndDateChange: actions.setEndDate,
        onBottomReached: actions.getMoreResults,
        hideDeleteConfirm: actions.hideDeleteConfirm,
    }, dispatch),
    deleteAssociatedDocs: metaDoc => () => dispatch(actions.deleteMeta(metaDoc, true)),
    deleteMeta: metaDoc => () => dispatch(actions.deleteMeta(metaDoc)),
})

export default connect(mapStateToProps, mapDispatchToProps)(Overview)
