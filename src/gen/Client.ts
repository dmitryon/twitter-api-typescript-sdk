// Copyright 2021 Twitter, Inc.
// SPDX-License-Identifier: Apache-2.0

/*
This file is auto-generated
Do not make direct changes to this file
*/

import { rest, stream, paginate, RequestOptions } from "../request";
import {
  AuthClient,
  TwitterResponse,
  TwitterBody,
  TwitterParams,
  TwitterPaginatedResponse,
} from "../types";
import { OAuth2Bearer } from "../auth";

import {
  getAccountActivitySubscriptionCount,
  validateAccountActivitySubscription,
  createAccountActivitySubscription,
  getAccountActivitySubscriptions,
  deleteAccountActivitySubscription,
  activityStream,
  deleteActivitySubscriptionsByIds,
  getActivitySubscriptions,
  createActivitySubscription,
  deleteActivitySubscription,
  updateActivitySubscription,
  getChatConversations,
  createChatConversation,
  initializeChatGroup,
  initializeChatConversationKeys,
  addChatGroupMembers,
  sendChatMessage,
  markChatConversationRead,
  sendChatTypingIndicator,
  chatMediaUploadInitialize,
  chatMediaUploadAppend,
  chatMediaUploadFinalize,
  chatMediaDownload,
  searchCommunities,
  getCommunitiesById,
  getComplianceJobs,
  createComplianceJobs,
  getComplianceJobsById,
  deleteConnectionsByUuids,
  getConnectionHistory,
  deleteAllConnections,
  deleteConnectionsByEndpoint,
  createDirectMessagesConversation,
  dmConversationsMediaDownload,
  getDirectMessagesEventsByParticipantId,
  createDirectMessagesByParticipantId,
  createDirectMessagesByConversationId,
  getDirectMessagesEventsByConversationId,
  getDirectMessagesEvents,
  deleteDirectMessagesEvents,
  getDirectMessagesEventsById,
  evaluateCommunityNotes,
  getInsights28Hr,
  getInsightsHistorical,
  streamLikesCompliance,
  streamLikesFirehose,
  streamLikesSample10,
  createLists,
  deleteLists,
  getListsById,
  updateLists,
  getListsFollowers,
  getListsMembers,
  addListsMember,
  removeListsMemberByUserId,
  getListsPosts,
  getMediaByMediaKeys,
  getMediaAnalytics,
  createMediaMetadata,
  deleteMediaSubtitles,
  createMediaSubtitles,
  getMediaUploadStatus,
  mediaUpload,
  initializeMediaUpload,
  appendMediaUpload,
  finalizeMediaUpload,
  getMediaByMediaKey,
  searchNews,
  getNews,
  createCommunityNotes,
  searchCommunityNotesWritten,
  searchEligiblePosts,
  deleteCommunityNotes,
  getOpenApiSpec,
  getSpacesByIds,
  getSpacesByCreatorIds,
  searchSpaces,
  getSpacesById,
  getSpacesBuyers,
  getSpacesPosts,
  getTrendsByWoeid,
  getPostsByIds,
  createPosts,
  getPostsAnalytics,
  streamPostsCompliance,
  getPostsCountsAll,
  getPostsCountsRecent,
  streamPostsFirehose,
  streamPostsFirehoseEn,
  streamPostsFirehoseJa,
  streamPostsFirehoseKo,
  streamPostsFirehosePt,
  streamLabelsCompliance,
  streamPostsSample,
  streamPostsSample10,
  searchPostsAll,
  searchPostsRecent,
  streamPosts,
  getRules,
  updateRules,
  getRuleCounts,
  getWebhooksStreamLinks,
  deleteWebhooksStreamLink,
  createWebhooksStreamLink,
  deletePosts,
  getPostsById,
  getPostsLikingUsers,
  getPostsQuotedPosts,
  getPostsRepostedBy,
  getPostsReposts,
  hidePostsReply,
  getUsage,
  getUsersByIds,
  getUsersByUsernames,
  getUsersByUsername,
  streamUsersCompliance,
  getUsersMe,
  getTrendsPersonalizedTrends,
  getUsersPublicKeys,
  getUsersRepostsOfMe,
  searchUsers,
  getUsersById,
  getUsersAffiliates,
  getUsersBlocking,
  getUsersBookmarks,
  createUsersBookmark,
  getUsersBookmarkFolders,
  getUsersBookmarksByFolderId,
  deleteUsersBookmark,
  blockUsersDms,
  unblockUsersDms,
  getUsersFollowedLists,
  followList,
  unfollowList,
  getUsersFollowers,
  getUsersFollowing,
  followUser,
  getUsersLikedPosts,
  likePost,
  unlikePost,
  getUsersListMemberships,
  getUsersMentions,
  getUsersMuting,
  muteUser,
  getUsersOwnedLists,
  getUsersPinnedLists,
  pinList,
  unpinList,
  getUsersPublicKey,
  addUserPublicKey,
  repostPost,
  unrepostPost,
  getUsersTimeline,
  getUsersPosts,
  unfollowUser,
  unmuteUser,
  getWebhooks,
  createWebhooks,
  createWebhookReplayJob,
  deleteWebhooks,
  validateWebhooks,
} from "./openapi-types";
/**
 * Twitter API TypeScript Client
 *
 * TypeScript SDK for use with the Twitter API
 *
 */
export class Client {
  #auth: AuthClient;
  #defaultRequestOptions?: Partial<RequestOptions>;
  version: string;
  twitterApiOpenApiVersion: string;

  constructor(
    auth: string | AuthClient,
    requestOptions?: Partial<RequestOptions>
  ) {
    this.version = "2.163";
    this.twitterApiOpenApiVersion = "2.163";
    this.#auth = typeof auth === "string" ? new OAuth2Bearer(auth) : auth;
    this.#defaultRequestOptions = {
      ...requestOptions,
      headers: {
        "User-Agent": "twitter-api-typescript-sdk/" + this.version,
        ...requestOptions?.headers,
      },
    };
  }

  /**
   * Compliance
   *
   * Endpoints related to keeping X data in your systems compliant
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api/compliance/batch-tweet/introduction
   */
  public readonly compliance = {
    /**
    * Get Compliance Jobs
    *

    * Retrieves a list of Compliance Jobs filtered by job type and optional status.
    * @param params - The params for getComplianceJobs
    * @param request_options - Customize the options for this request
    */
    getComplianceJobs: (
      params: TwitterParams<getComplianceJobs>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getComplianceJobs>> =>
      rest<TwitterResponse<getComplianceJobs>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/compliance/jobs`,
        params,
        method: "GET",
      }),

    /**
    * Create Compliance Job
    *

    * Creates a new Compliance Job for the specified job type.
    * @param request_body - The request_body for createComplianceJobs
    * @param request_options - Customize the options for this request
    */
    createComplianceJobs: (
      request_body: TwitterBody<createComplianceJobs>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createComplianceJobs>> =>
      rest<TwitterResponse<createComplianceJobs>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/compliance/jobs`,
        request_body,
        method: "POST",
      }),

    /**
    * Get Compliance Job by ID
    *

    * Retrieves details of a specific Compliance Job by its ID.
    * @param id - The ID of the Compliance Job to retrieve.
    * @param params - The params for getComplianceJobsById
    * @param request_options - Customize the options for this request
    */
    getComplianceJobsById: (
      id: string,
      params: TwitterParams<getComplianceJobsById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getComplianceJobsById>> =>
      rest<TwitterResponse<getComplianceJobsById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/compliance/jobs/${id}`,
        params,
        method: "GET",
      }),
  };
  /**
   * Connections
   *
   * Endpoints related to streaming connections
   *
   * Find out more
   * https://developer.x.com/en/docs/x-api/connections
   */
  public readonly connections = {
    /**
    * Terminate multiple connections
    *

    * Terminates multiple streaming connections by their UUIDs for the authenticated application.
    * @param request_body - The request_body for deleteConnectionsByUuids
    * @param request_options - Customize the options for this request
    */
    deleteConnectionsByUuids: (
      request_body: TwitterBody<deleteConnectionsByUuids>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteConnectionsByUuids>> =>
      rest<TwitterResponse<deleteConnectionsByUuids>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/connections`,
        request_body,
        method: "DELETE",
      }),

    /**
    * Get Connection History
    *

    * Returns active and historical streaming connections with disconnect reasons for the authenticated application.
    * @param params - The params for getConnectionHistory
    * @param request_options - Customize the options for this request
    */
    getConnectionHistory: (
      params: TwitterParams<getConnectionHistory> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getConnectionHistory>> =>
      paginate<TwitterResponse<getConnectionHistory>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/connections`,
        params,
        method: "GET",
      }),

    /**
    * Terminate all connections
    *

    * Terminates all active streaming connections for the authenticated application.
    * @param request_options - Customize the options for this request
    */
    deleteAllConnections: (
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteAllConnections>> =>
      rest<TwitterResponse<deleteAllConnections>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/connections/all`,
        method: "DELETE",
      }),

    /**
    * Terminate connections by endpoint
    *

    * Terminates all streaming connections for a specific endpoint ID for the authenticated application.
    * @param endpoint_id - The endpoint ID to terminate connections for.
    * @param request_options - Customize the options for this request
    */
    deleteConnectionsByEndpoint: (
      endpoint_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteConnectionsByEndpoint>> =>
      rest<TwitterResponse<deleteConnectionsByEndpoint>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/connections/${endpoint_id}`,
        method: "DELETE",
      }),
  };
  /**
   * General
   *
   * Miscellaneous endpoints for general API functionality
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api
   */
  public readonly general = {
    /**
    * Get OpenAPI Spec.
    *

    * Retrieves the full OpenAPI Specification in JSON format. (See https://github.com/OAI/OpenAPI-Specification/blob/master/README.md)
    * @param request_options - Customize the options for this request
    */
    getOpenApiSpec: (
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getOpenApiSpec>> =>
      rest<TwitterResponse<getOpenApiSpec>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/openapi.json`,
        method: "GET",
      }),
  };
  /**
   * Lists
   *
   * Endpoints related to retrieving, managing Lists
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api/lists
   */
  public readonly lists = {
    /**
    * Create List
    *

    * Creates a new List for the authenticated user.
    * @param request_body - The request_body for createLists
    * @param request_options - Customize the options for this request
    */
    createLists: (
      request_body: TwitterBody<createLists>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createLists>> =>
      rest<TwitterResponse<createLists>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists`,
        request_body,
        method: "POST",
      }),

    /**
    * Delete List
    *

    * Deletes a specific List owned by the authenticated user by its ID.
    * @param id - The ID of the List to delete.
    * @param request_options - Customize the options for this request
    */
    deleteLists: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteLists>> =>
      rest<TwitterResponse<deleteLists>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}`,
        method: "DELETE",
      }),

    /**
    * Get List by ID
    *

    * Retrieves details of a specific List by its ID.
    * @param id - The ID of the List.
    * @param params - The params for getListsById
    * @param request_options - Customize the options for this request
    */
    getListsById: (
      id: string,
      params: TwitterParams<getListsById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getListsById>> =>
      rest<TwitterResponse<getListsById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}`,
        params,
        method: "GET",
      }),

    /**
    * Update List
    *

    * Updates the details of a specific List owned by the authenticated user by its ID.
    * @param id - The ID of the List to modify.
    * @param request_body - The request_body for updateLists
    * @param request_options - Customize the options for this request
    */
    updateLists: (
      id: string,
      request_body: TwitterBody<updateLists>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<updateLists>> =>
      rest<TwitterResponse<updateLists>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}`,
        request_body,
        method: "PUT",
      }),

    /**
    * Get List followers
    *

    * Retrieves a list of Users who follow a specific List by its ID.
    * @param id - The ID of the List.
    * @param params - The params for getListsFollowers
    * @param request_options - Customize the options for this request
    */
    getListsFollowers: (
      id: string,
      params: TwitterParams<getListsFollowers> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getListsFollowers>> =>
      paginate<TwitterResponse<getListsFollowers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}/followers`,
        params,
        method: "GET",
      }),

    /**
    * Get List members
    *

    * Retrieves a list of Users who are members of a specific List by its ID.
    * @param id - The ID of the List.
    * @param params - The params for getListsMembers
    * @param request_options - Customize the options for this request
    */
    getListsMembers: (
      id: string,
      params: TwitterParams<getListsMembers> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getListsMembers>> =>
      paginate<TwitterResponse<getListsMembers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}/members`,
        params,
        method: "GET",
      }),

    /**
    * Add List member
    *

    * Adds a User to a specific List by its ID.
    * @param id - The ID of the List for which to add a member.
    * @param request_body - The request_body for addListsMember
    * @param request_options - Customize the options for this request
    */
    addListsMember: (
      id: string,
      request_body: TwitterBody<addListsMember>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<addListsMember>> =>
      rest<TwitterResponse<addListsMember>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}/members`,
        request_body,
        method: "POST",
      }),

    /**
    * Remove List member
    *

    * Removes a User from a specific List by its ID and the User’s ID.
    * @param id - The ID of the List to remove a member.
    * @param user_id - The ID of User that will be removed from the List.
    * @param request_options - Customize the options for this request
    */
    removeListsMemberByUserId: (
      id: string,
      user_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<removeListsMemberByUserId>> =>
      rest<TwitterResponse<removeListsMemberByUserId>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}/members/${user_id}`,
        method: "DELETE",
      }),

    /**
    * Get List Posts
    *

    * Retrieves a list of Posts associated with a specific List by its ID.
    * @param id - The ID of the List.
    * @param params - The params for getListsPosts
    * @param request_options - Customize the options for this request
    */
    getListsPosts: (
      id: string,
      params: TwitterParams<getListsPosts> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getListsPosts>> =>
      paginate<TwitterResponse<getListsPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/lists/${id}/tweets`,
        params,
        method: "GET",
      }),
  };
  /**
   * Media
   *
   * Endpoints related to Media
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly media = {
    /**
    * Get Media by media keys
    *

    * Retrieves details of Media files by their media keys.
    * @param params - The params for getMediaByMediaKeys
    * @param request_options - Customize the options for this request
    */
    getMediaByMediaKeys: (
      params: TwitterParams<getMediaByMediaKeys>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getMediaByMediaKeys>> =>
      rest<TwitterResponse<getMediaByMediaKeys>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media`,
        params,
        method: "GET",
      }),

    /**
    * Get Media analytics
    *

    * Retrieves analytics data for media.
    * @param params - The params for getMediaAnalytics
    * @param request_options - Customize the options for this request
    */
    getMediaAnalytics: (
      params: TwitterParams<getMediaAnalytics>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getMediaAnalytics>> =>
      rest<TwitterResponse<getMediaAnalytics>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/analytics`,
        params,
        method: "GET",
      }),

    /**
    * Create Media metadata
    *

    * Creates metadata for a Media file.
    * @param request_body - The request_body for createMediaMetadata
    * @param request_options - Customize the options for this request
    */
    createMediaMetadata: (
      request_body: TwitterBody<createMediaMetadata>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createMediaMetadata>> =>
      rest<TwitterResponse<createMediaMetadata>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/metadata`,
        request_body,
        method: "POST",
      }),

    /**
    * Delete Media subtitles
    *

    * Deletes subtitles for a specific Media file.
    * @param request_body - The request_body for deleteMediaSubtitles
    * @param request_options - Customize the options for this request
    */
    deleteMediaSubtitles: (
      request_body: TwitterBody<deleteMediaSubtitles>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteMediaSubtitles>> =>
      rest<TwitterResponse<deleteMediaSubtitles>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/subtitles`,
        request_body,
        method: "DELETE",
      }),

    /**
    * Create Media subtitles
    *

    * Creates subtitles for a specific Media file.
    * @param request_body - The request_body for createMediaSubtitles
    * @param request_options - Customize the options for this request
    */
    createMediaSubtitles: (
      request_body: TwitterBody<createMediaSubtitles>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createMediaSubtitles>> =>
      rest<TwitterResponse<createMediaSubtitles>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/subtitles`,
        request_body,
        method: "POST",
      }),

    /**
    * Get Media upload status
    *

    * Retrieves the status of a Media upload by its ID.
    * @param params - The params for getMediaUploadStatus
    * @param request_options - Customize the options for this request
    */
    getMediaUploadStatus: (
      params: TwitterParams<getMediaUploadStatus>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getMediaUploadStatus>> =>
      rest<TwitterResponse<getMediaUploadStatus>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/upload`,
        params,
        method: "GET",
      }),

    /**
    * Upload media
    *

    * Uploads a media file for use in posts or other content.
    * @param request_body - The request_body for mediaUpload
    * @param request_options - Customize the options for this request
    */
    mediaUpload: (
      request_body: TwitterBody<mediaUpload>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<mediaUpload>> =>
      rest<TwitterResponse<mediaUpload>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/upload`,
        request_body,
        method: "POST",
      }),

    /**
    * Initialize media upload
    *

    * Initializes a media upload.
    * @param request_body - The request_body for initializeMediaUpload
    * @param request_options - Customize the options for this request
    */
    initializeMediaUpload: (
      request_body: TwitterBody<initializeMediaUpload>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<initializeMediaUpload>> =>
      rest<TwitterResponse<initializeMediaUpload>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/upload/initialize`,
        request_body,
        method: "POST",
      }),

    /**
    * Append Media upload
    *

    * Appends data to a Media upload request.
    * @param id - The media identifier for the media to perform the append operation.
    * @param request_body - The request_body for appendMediaUpload
    * @param request_options - Customize the options for this request
    */
    appendMediaUpload: (
      id: string,
      request_body: TwitterBody<appendMediaUpload>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<appendMediaUpload>> =>
      rest<TwitterResponse<appendMediaUpload>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/upload/${id}/append`,
        request_body,
        method: "POST",
      }),

    /**
    * Finalize Media upload
    *

    * Finalizes a Media upload request.
    * @param id - The media id of the targeted media to finalize.
    * @param request_options - Customize the options for this request
    */
    finalizeMediaUpload: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<finalizeMediaUpload>> =>
      rest<TwitterResponse<finalizeMediaUpload>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/upload/${id}/finalize`,
        method: "POST",
      }),

    /**
    * Get Media by media key
    *

    * Retrieves details of a specific Media file by its media key.
    * @param media_key - A single Media Key.
    * @param params - The params for getMediaByMediaKey
    * @param request_options - Customize the options for this request
    */
    getMediaByMediaKey: (
      media_key: string,
      params: TwitterParams<getMediaByMediaKey> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getMediaByMediaKey>> =>
      rest<TwitterResponse<getMediaByMediaKey>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/media/${media_key}`,
        params,
        method: "GET",
      }),
  };
  /**
   * News
   *
   * Endpoint for retrieving news stories
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api/news
   */
  public readonly news = {
    /**
    * Search News
    *

    * Retrieves a list of News stories matching the specified search query.
    * @param params - The params for searchNews
    * @param request_options - Customize the options for this request
    */
    searchNews: (
      params: TwitterParams<searchNews>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<searchNews>> =>
      rest<TwitterResponse<searchNews>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/news/search`,
        params,
        method: "GET",
      }),

    /**
    * Get news stories by ID
    *

    * Retrieves news story by its ID.
    * @param id - The ID of the news story.
    * @param params - The params for getNews
    * @param request_options - Customize the options for this request
    */
    getNews: (
      id: string,
      params: TwitterParams<getNews> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getNews>> =>
      rest<TwitterResponse<getNews>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/news/${id}`,
        params,
        method: "GET",
      }),
  };
  /**
   * Spaces
   *
   * Endpoints related to retrieving, managing Spaces
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api/spaces
   */
  public readonly spaces = {
    /**
    * Get Spaces by IDs
    *

    * Retrieves details of multiple Spaces by their IDs.
    * @param params - The params for getSpacesByIds
    * @param request_options - Customize the options for this request
    */
    getSpacesByIds: (
      params: TwitterParams<getSpacesByIds>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getSpacesByIds>> =>
      rest<TwitterResponse<getSpacesByIds>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/spaces`,
        params,
        method: "GET",
      }),

    /**
    * Get Spaces by creator IDs
    *

    * Retrieves details of Spaces created by specified User IDs.
    * @param params - The params for getSpacesByCreatorIds
    * @param request_options - Customize the options for this request
    */
    getSpacesByCreatorIds: (
      params: TwitterParams<getSpacesByCreatorIds>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getSpacesByCreatorIds>> =>
      rest<TwitterResponse<getSpacesByCreatorIds>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/spaces/by/creator_ids`,
        params,
        method: "GET",
      }),

    /**
    * Search Spaces
    *

    * Retrieves a list of Spaces matching the specified search query.
    * @param params - The params for searchSpaces
    * @param request_options - Customize the options for this request
    */
    searchSpaces: (
      params: TwitterParams<searchSpaces>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<searchSpaces>> =>
      rest<TwitterResponse<searchSpaces>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/spaces/search`,
        params,
        method: "GET",
      }),

    /**
    * Get space by ID
    *

    * Retrieves details of a specific space by its ID.
    * @param id - The ID of the Space to be retrieved.
    * @param params - The params for getSpacesById
    * @param request_options - Customize the options for this request
    */
    getSpacesById: (
      id: string,
      params: TwitterParams<getSpacesById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getSpacesById>> =>
      rest<TwitterResponse<getSpacesById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/spaces/${id}`,
        params,
        method: "GET",
      }),

    /**
    * Get Space ticket buyers
    *

    * Retrieves a list of Users who purchased tickets to a specific Space by its ID.
    * @param id - The ID of the Space to be retrieved.
    * @param params - The params for getSpacesBuyers
    * @param request_options - Customize the options for this request
    */
    getSpacesBuyers: (
      id: string,
      params: TwitterParams<getSpacesBuyers> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getSpacesBuyers>> =>
      paginate<TwitterResponse<getSpacesBuyers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/spaces/${id}/buyers`,
        params,
        method: "GET",
      }),

    /**
    * Get Space Posts
    *

    * Retrieves a list of Posts shared in a specific Space by its ID.
    * @param id - The ID of the Space to be retrieved.
    * @param params - The params for getSpacesPosts
    * @param request_options - Customize the options for this request
    */
    getSpacesPosts: (
      id: string,
      params: TwitterParams<getSpacesPosts> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getSpacesPosts>> =>
      rest<TwitterResponse<getSpacesPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/spaces/${id}/tweets`,
        params,
        method: "GET",
      }),
  };
  /**
   * Stream
   *
   * Endpoints related to streaming
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly stream = {
    /**
    * Stream Likes compliance data
    *

    * Streams all compliance data related to Likes for Users.
    * @param params - The params for streamLikesCompliance
    * @param request_options - Customize the options for this request
    */
    streamLikesCompliance: (
      params: TwitterParams<streamLikesCompliance> = {},
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamLikesCompliance>> =>
      stream<TwitterResponse<streamLikesCompliance>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/likes/compliance/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream all Likes
    *

    * Streams all public Likes in real-time.
    * @param params - The params for streamLikesFirehose
    * @param request_options - Customize the options for this request
    */
    streamLikesFirehose: (
      params: TwitterParams<streamLikesFirehose>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamLikesFirehose>> =>
      stream<TwitterResponse<streamLikesFirehose>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/likes/firehose/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream sampled Likes
    *

    * Streams a 10% sample of public Likes in real-time.
    * @param params - The params for streamLikesSample10
    * @param request_options - Customize the options for this request
    */
    streamLikesSample10: (
      params: TwitterParams<streamLikesSample10>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamLikesSample10>> =>
      stream<TwitterResponse<streamLikesSample10>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/likes/sample10/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream Posts compliance data
    *

    * Streams all compliance data related to Posts.
    * @param params - The params for streamPostsCompliance
    * @param request_options - Customize the options for this request
    */
    streamPostsCompliance: (
      params: TwitterParams<streamPostsCompliance>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsCompliance>> =>
      stream<TwitterResponse<streamPostsCompliance>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/compliance/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream all Posts
    *

    * Streams all public Posts in real-time.
    * @param params - The params for streamPostsFirehose
    * @param request_options - Customize the options for this request
    */
    streamPostsFirehose: (
      params: TwitterParams<streamPostsFirehose>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsFirehose>> =>
      stream<TwitterResponse<streamPostsFirehose>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/firehose/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream English Posts
    *

    * Streams all public English-language Posts in real-time.
    * @param params - The params for streamPostsFirehoseEn
    * @param request_options - Customize the options for this request
    */
    streamPostsFirehoseEn: (
      params: TwitterParams<streamPostsFirehoseEn>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsFirehoseEn>> =>
      stream<TwitterResponse<streamPostsFirehoseEn>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/firehose/stream/lang/en`,
        params,
        method: "GET",
      }),

    /**
    * Stream Japanese Posts
    *

    * Streams all public Japanese-language Posts in real-time.
    * @param params - The params for streamPostsFirehoseJa
    * @param request_options - Customize the options for this request
    */
    streamPostsFirehoseJa: (
      params: TwitterParams<streamPostsFirehoseJa>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsFirehoseJa>> =>
      stream<TwitterResponse<streamPostsFirehoseJa>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/firehose/stream/lang/ja`,
        params,
        method: "GET",
      }),

    /**
    * Stream Korean Posts
    *

    * Streams all public Korean-language Posts in real-time.
    * @param params - The params for streamPostsFirehoseKo
    * @param request_options - Customize the options for this request
    */
    streamPostsFirehoseKo: (
      params: TwitterParams<streamPostsFirehoseKo>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsFirehoseKo>> =>
      stream<TwitterResponse<streamPostsFirehoseKo>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/firehose/stream/lang/ko`,
        params,
        method: "GET",
      }),

    /**
    * Stream Portuguese Posts
    *

    * Streams all public Portuguese-language Posts in real-time.
    * @param params - The params for streamPostsFirehosePt
    * @param request_options - Customize the options for this request
    */
    streamPostsFirehosePt: (
      params: TwitterParams<streamPostsFirehosePt>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsFirehosePt>> =>
      stream<TwitterResponse<streamPostsFirehosePt>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/firehose/stream/lang/pt`,
        params,
        method: "GET",
      }),

    /**
    * Stream Post labels
    *

    * Streams all labeling events applied to Posts.
    * @param params - The params for streamLabelsCompliance
    * @param request_options - Customize the options for this request
    */
    streamLabelsCompliance: (
      params: TwitterParams<streamLabelsCompliance> = {},
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamLabelsCompliance>> =>
      stream<TwitterResponse<streamLabelsCompliance>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/label/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream sampled Posts
    *

    * Streams a 1% sample of public Posts in real-time.
    * @param params - The params for streamPostsSample
    * @param request_options - Customize the options for this request
    */
    streamPostsSample: (
      params: TwitterParams<streamPostsSample> = {},
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsSample>> =>
      stream<TwitterResponse<streamPostsSample>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/sample/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream 10% sampled Posts
    *

    * Streams a 10% sample of public Posts in real-time.
    * @param params - The params for streamPostsSample10
    * @param request_options - Customize the options for this request
    */
    streamPostsSample10: (
      params: TwitterParams<streamPostsSample10>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPostsSample10>> =>
      stream<TwitterResponse<streamPostsSample10>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/sample10/stream`,
        params,
        method: "GET",
      }),

    /**
    * Stream filtered Posts
    *

    * Streams Posts in real-time matching the active rule set.
    * @param params - The params for streamPosts
    * @param request_options - Customize the options for this request
    */
    streamPosts: (
      params: TwitterParams<streamPosts> = {},
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamPosts>> =>
      stream<TwitterResponse<streamPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/stream`,
        params,
        method: "GET",
      }),

    /**
    * Get stream rules
    *

    * Retrieves the active rule set or a subset of rules for the filtered stream.
    * @param params - The params for getRules
    * @param request_options - Customize the options for this request
    */
    getRules: (
      params: TwitterParams<getRules> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getRules>> =>
      paginate<TwitterResponse<getRules>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/stream/rules`,
        params,
        method: "GET",
      }),

    /**
    * Update stream rules
    *

    * Adds or deletes rules from the active rule set for the filtered stream.
    * @param params - The params for updateRules
    * @param request_body - The request_body for updateRules
    * @param request_options - Customize the options for this request
    */
    updateRules: (
      request_body: TwitterBody<updateRules>,
      params: TwitterParams<updateRules> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<updateRules>> =>
      rest<TwitterResponse<updateRules>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/stream/rules`,
        params,
        request_body,
        method: "POST",
      }),

    /**
    * Get stream rule counts
    *

    * Retrieves the count of rules in the active rule set for the filtered stream.
    * @param params - The params for getRuleCounts
    * @param request_options - Customize the options for this request
    */
    getRuleCounts: (
      params: TwitterParams<getRuleCounts> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getRuleCounts>> =>
      rest<TwitterResponse<getRuleCounts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/stream/rules/counts`,
        params,
        method: "GET",
      }),

    /**
    * Stream Users compliance data
    *

    * Streams all compliance data related to Users.
    * @param params - The params for streamUsersCompliance
    * @param request_options - Customize the options for this request
    */
    streamUsersCompliance: (
      params: TwitterParams<streamUsersCompliance>,
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<streamUsersCompliance>> =>
      stream<TwitterResponse<streamUsersCompliance>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/compliance/stream`,
        params,
        method: "GET",
      }),
  };
  /**
   * Tweets
   *
   * Endpoints related to retrieving, searching, and modifying Tweets
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api/tweets/lookup
   */
  public readonly tweets = {
    /**
    * Get 28-hour Post insights
    *

    * Retrieves engagement metrics for specified Posts over the last 28 hours.
    * @param params - The params for getInsights28Hr
    * @param request_options - Customize the options for this request
    */
    getInsights28Hr: (
      params: TwitterParams<getInsights28Hr>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getInsights28Hr>> =>
      rest<TwitterResponse<getInsights28Hr>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/insights/28hr`,
        params,
        method: "GET",
      }),

    /**
    * Get historical Post insights
    *

    * Retrieves historical engagement metrics for specified Posts within a defined time range.
    * @param params - The params for getInsightsHistorical
    * @param request_options - Customize the options for this request
    */
    getInsightsHistorical: (
      params: TwitterParams<getInsightsHistorical>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getInsightsHistorical>> =>
      rest<TwitterResponse<getInsightsHistorical>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/insights/historical`,
        params,
        method: "GET",
      }),

    /**
    * Get Posts by IDs
    *

    * Retrieves details of multiple Posts by their IDs.
    * @param params - The params for getPostsByIds
    * @param request_options - Customize the options for this request
    */
    getPostsByIds: (
      params: TwitterParams<getPostsByIds>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getPostsByIds>> =>
      rest<TwitterResponse<getPostsByIds>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets`,
        params,
        method: "GET",
      }),

    /**
    * Create or Edit Post
    *

    * Creates a new Post for the authenticated user, or edits an existing Post when edit_options are provided. Supports paid partnership disclosure via the paid_partnership field.
    * @param request_body - The request_body for createPosts
    * @param request_options - Customize the options for this request
    */
    createPosts: (
      request_body: TwitterBody<createPosts>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createPosts>> =>
      rest<TwitterResponse<createPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets`,
        request_body,
        method: "POST",
      }),

    /**
    * Get Post analytics
    *

    * Retrieves analytics data for specified Posts within a defined time range.
    * @param params - The params for getPostsAnalytics
    * @param request_options - Customize the options for this request
    */
    getPostsAnalytics: (
      params: TwitterParams<getPostsAnalytics>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getPostsAnalytics>> =>
      rest<TwitterResponse<getPostsAnalytics>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/analytics`,
        params,
        method: "GET",
      }),

    /**
    * Get count of all Posts
    *

    * Retrieves the count of Posts matching a search query from the full archive.
    * @param params - The params for getPostsCountsAll
    * @param request_options - Customize the options for this request
    */
    getPostsCountsAll: (
      params: TwitterParams<getPostsCountsAll>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getPostsCountsAll>> =>
      paginate<TwitterResponse<getPostsCountsAll>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/counts/all`,
        params,
        method: "GET",
      }),

    /**
    * Get count of recent Posts
    *

    * Retrieves the count of Posts from the last 7 days matching a search query.
    * @param params - The params for getPostsCountsRecent
    * @param request_options - Customize the options for this request
    */
    getPostsCountsRecent: (
      params: TwitterParams<getPostsCountsRecent>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getPostsCountsRecent>> =>
      paginate<TwitterResponse<getPostsCountsRecent>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/counts/recent`,
        params,
        method: "GET",
      }),

    /**
    * Search all Posts
    *

    * Retrieves Posts from the full archive matching a search query.
    * @param params - The params for searchPostsAll
    * @param request_options - Customize the options for this request
    */
    searchPostsAll: (
      params: TwitterParams<searchPostsAll>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<searchPostsAll>> =>
      paginate<TwitterResponse<searchPostsAll>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/all`,
        params,
        method: "GET",
      }),

    /**
    * Search recent Posts
    *

    * Retrieves Posts from the last 7 days matching a search query.
    * @param params - The params for searchPostsRecent
    * @param request_options - Customize the options for this request
    */
    searchPostsRecent: (
      params: TwitterParams<searchPostsRecent>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<searchPostsRecent>> =>
      paginate<TwitterResponse<searchPostsRecent>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/recent`,
        params,
        method: "GET",
      }),

    /**
    * Delete Post
    *

    * Deletes a specific Post by its ID, if owned by the authenticated user.
    * @param id - The ID of the Post to be deleted.
    * @param request_options - Customize the options for this request
    */
    deletePosts: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deletePosts>> =>
      rest<TwitterResponse<deletePosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${id}`,
        method: "DELETE",
      }),

    /**
    * Get Post by ID
    *

    * Retrieves details of a specific Post by its ID.
    * @param id - A single Post ID.
    * @param params - The params for getPostsById
    * @param request_options - Customize the options for this request
    */
    getPostsById: (
      id: string,
      params: TwitterParams<getPostsById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getPostsById>> =>
      rest<TwitterResponse<getPostsById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${id}`,
        params,
        method: "GET",
      }),

    /**
    * Get Liking Users
    *

    * Retrieves a list of Users who liked a specific Post by its ID.
    * @param id - A single Post ID.
    * @param params - The params for getPostsLikingUsers
    * @param request_options - Customize the options for this request
    */
    getPostsLikingUsers: (
      id: string,
      params: TwitterParams<getPostsLikingUsers> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getPostsLikingUsers>> =>
      paginate<TwitterResponse<getPostsLikingUsers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${id}/liking_users`,
        params,
        method: "GET",
      }),

    /**
    * Get Quoted Posts
    *

    * Retrieves a list of Posts that quote a specific Post by its ID.
    * @param id - A single Post ID.
    * @param params - The params for getPostsQuotedPosts
    * @param request_options - Customize the options for this request
    */
    getPostsQuotedPosts: (
      id: string,
      params: TwitterParams<getPostsQuotedPosts> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getPostsQuotedPosts>> =>
      paginate<TwitterResponse<getPostsQuotedPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${id}/quote_tweets`,
        params,
        method: "GET",
      }),

    /**
    * Get Reposted by
    *

    * Retrieves a list of Users who reposted a specific Post by its ID.
    * @param id - A single Post ID.
    * @param params - The params for getPostsRepostedBy
    * @param request_options - Customize the options for this request
    */
    getPostsRepostedBy: (
      id: string,
      params: TwitterParams<getPostsRepostedBy> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getPostsRepostedBy>> =>
      paginate<TwitterResponse<getPostsRepostedBy>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${id}/retweeted_by`,
        params,
        method: "GET",
      }),

    /**
    * Get Reposts
    *

    * Retrieves a list of Posts that repost a specific Post by its ID.
    * @param id - A single Post ID.
    * @param params - The params for getPostsReposts
    * @param request_options - Customize the options for this request
    */
    getPostsReposts: (
      id: string,
      params: TwitterParams<getPostsReposts> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getPostsReposts>> =>
      paginate<TwitterResponse<getPostsReposts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${id}/retweets`,
        params,
        method: "GET",
      }),

    /**
    * Hide reply
    *

    * Hides or unhides a reply to a conversation owned by the authenticated user.
    * @param tweet_id - The ID of the reply that you want to hide or unhide.
    * @param request_body - The request_body for hidePostsReply
    * @param request_options - Customize the options for this request
    */
    hidePostsReply: (
      tweet_id: string,
      request_body: TwitterBody<hidePostsReply>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<hidePostsReply>> =>
      rest<TwitterResponse<hidePostsReply>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/${tweet_id}/hidden`,
        request_body,
        method: "PUT",
      }),
  };
  /**
   * Users
   *
   * Endpoints related to retrieving, managing relationships of Users
   *
   * Find out more
   * https://developer.twitter.com/en/docs/twitter-api/users/lookup
   */
  public readonly users = {
    /**
    * Get Users by IDs
    *

    * Retrieves details of multiple Users by their IDs.
    * @param params - The params for getUsersByIds
    * @param request_options - Customize the options for this request
    */
    getUsersByIds: (
      params: TwitterParams<getUsersByIds>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersByIds>> =>
      rest<TwitterResponse<getUsersByIds>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users`,
        params,
        method: "GET",
      }),

    /**
    * Get Users by usernames
    *

    * Retrieves details of multiple Users by their usernames.
    * @param params - The params for getUsersByUsernames
    * @param request_options - Customize the options for this request
    */
    getUsersByUsernames: (
      params: TwitterParams<getUsersByUsernames>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersByUsernames>> =>
      rest<TwitterResponse<getUsersByUsernames>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/by`,
        params,
        method: "GET",
      }),

    /**
    * Get User by username
    *

    * Retrieves details of a specific User by their username.
    * @param username - A username.
    * @param params - The params for getUsersByUsername
    * @param request_options - Customize the options for this request
    */
    getUsersByUsername: (
      username: string,
      params: TwitterParams<getUsersByUsername> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersByUsername>> =>
      rest<TwitterResponse<getUsersByUsername>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/by/username/${username}`,
        params,
        method: "GET",
      }),

    /**
    * Get my User
    *

    * Retrieves details of the authenticated user.
    * @param params - The params for getUsersMe
    * @param request_options - Customize the options for this request
    */
    getUsersMe: (
      params: TwitterParams<getUsersMe> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersMe>> =>
      rest<TwitterResponse<getUsersMe>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/me`,
        params,
        method: "GET",
      }),

    /**
    * Get public keys for multiple users
    *

    * Returns the public keys and Juicebox configuration for the specified users.
    * @param params - The params for getUsersPublicKeys
    * @param request_options - Customize the options for this request
    */
    getUsersPublicKeys: (
      params: TwitterParams<getUsersPublicKeys>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersPublicKeys>> =>
      rest<TwitterResponse<getUsersPublicKeys>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/public_keys`,
        params,
        method: "GET",
      }),

    /**
    * Get Reposts of me
    *

    * Retrieves a list of Posts that repost content from the authenticated user.
    * @param params - The params for getUsersRepostsOfMe
    * @param request_options - Customize the options for this request
    */
    getUsersRepostsOfMe: (
      params: TwitterParams<getUsersRepostsOfMe> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersRepostsOfMe>> =>
      paginate<TwitterResponse<getUsersRepostsOfMe>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/reposts_of_me`,
        params,
        method: "GET",
      }),

    /**
    * Search Users
    *

    * Retrieves a list of Users matching a search query.
    * @param params - The params for searchUsers
    * @param request_options - Customize the options for this request
    */
    searchUsers: (
      params: TwitterParams<searchUsers>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<searchUsers>> =>
      rest<TwitterResponse<searchUsers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/search`,
        params,
        method: "GET",
      }),

    /**
    * Get User by ID
    *

    * Retrieves details of a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersById
    * @param request_options - Customize the options for this request
    */
    getUsersById: (
      id: string,
      params: TwitterParams<getUsersById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersById>> =>
      rest<TwitterResponse<getUsersById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}`,
        params,
        method: "GET",
      }),

    /**
    * Get affiliates
    *

    * Retrieves a list of Users who are affiliated with a specific organization User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersAffiliates
    * @param request_options - Customize the options for this request
    */
    getUsersAffiliates: (
      id: string,
      params: TwitterParams<getUsersAffiliates> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersAffiliates>> =>
      paginate<TwitterResponse<getUsersAffiliates>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/affiliates`,
        params,
        method: "GET",
      }),

    /**
    * Get blocking
    *

    * Retrieves a list of Users blocked by the specified User ID.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param params - The params for getUsersBlocking
    * @param request_options - Customize the options for this request
    */
    getUsersBlocking: (
      id: string,
      params: TwitterParams<getUsersBlocking> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersBlocking>> =>
      paginate<TwitterResponse<getUsersBlocking>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/blocking`,
        params,
        method: "GET",
      }),

    /**
    * Get Bookmarks
    *

    * Retrieves a list of Posts bookmarked by the authenticated user.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param params - The params for getUsersBookmarks
    * @param request_options - Customize the options for this request
    */
    getUsersBookmarks: (
      id: string,
      params: TwitterParams<getUsersBookmarks> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersBookmarks>> =>
      paginate<TwitterResponse<getUsersBookmarks>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/bookmarks`,
        params,
        method: "GET",
      }),

    /**
    * Create Bookmark
    *

    * Adds a post to the authenticated user’s bookmarks.
    * @param id - The ID of the authenticated source User for whom to add bookmarks.
    * @param request_body - The request_body for createUsersBookmark
    * @param request_options - Customize the options for this request
    */
    createUsersBookmark: (
      id: string,
      request_body: TwitterBody<createUsersBookmark>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createUsersBookmark>> =>
      rest<TwitterResponse<createUsersBookmark>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/bookmarks`,
        request_body,
        method: "POST",
      }),

    /**
    * Get Bookmark folders
    *

    * Retrieves a list of Bookmark folders created by the authenticated user.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param params - The params for getUsersBookmarkFolders
    * @param request_options - Customize the options for this request
    */
    getUsersBookmarkFolders: (
      id: string,
      params: TwitterParams<getUsersBookmarkFolders> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersBookmarkFolders>> =>
      paginate<TwitterResponse<getUsersBookmarkFolders>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/bookmarks/folders`,
        params,
        method: "GET",
      }),

    /**
    * Get Bookmarks by folder ID
    *

    * Retrieves Posts in a specific Bookmark folder by its ID for the authenticated user.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param folder_id - The ID of the Bookmark Folder that the authenticated User is trying to fetch Posts for.
    * @param request_options - Customize the options for this request
    */
    getUsersBookmarksByFolderId: (
      id: string,
      folder_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersBookmarksByFolderId>> =>
      rest<TwitterResponse<getUsersBookmarksByFolderId>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/bookmarks/folders/${folder_id}`,
        method: "GET",
      }),

    /**
    * Delete Bookmark
    *

    * Removes a Post from the authenticated user’s Bookmarks by its ID.
    * @param id - The ID of the authenticated source User whose bookmark is to be removed.
    * @param tweet_id - The ID of the Post that the source User is removing from bookmarks.
    * @param request_options - Customize the options for this request
    */
    deleteUsersBookmark: (
      id: string,
      tweet_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteUsersBookmark>> =>
      rest<TwitterResponse<deleteUsersBookmark>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/bookmarks/${tweet_id}`,
        method: "DELETE",
      }),

    /**
    * Block DMs
    *

    * Blocks direct messages to or from a specific User by their ID for the authenticated user.
    * @param id - The ID of the target User that the authenticated user requesting to block dms for.
    * @param request_options - Customize the options for this request
    */
    blockUsersDms: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<blockUsersDms>> =>
      rest<TwitterResponse<blockUsersDms>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/dm/block`,
        method: "POST",
      }),

    /**
    * Unblock DMs
    *

    * Unblocks direct messages to or from a specific User by their ID for the authenticated user.
    * @param id - The ID of the target User that the authenticated user requesting to unblock dms for.
    * @param request_options - Customize the options for this request
    */
    unblockUsersDms: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unblockUsersDms>> =>
      rest<TwitterResponse<unblockUsersDms>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/dm/unblock`,
        method: "POST",
      }),

    /**
    * Get followed Lists
    *

    * Retrieves a list of Lists followed by a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersFollowedLists
    * @param request_options - Customize the options for this request
    */
    getUsersFollowedLists: (
      id: string,
      params: TwitterParams<getUsersFollowedLists> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersFollowedLists>> =>
      paginate<TwitterResponse<getUsersFollowedLists>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/followed_lists`,
        params,
        method: "GET",
      }),

    /**
    * Follow List
    *

    * Causes the authenticated user to follow a specific List by its ID.
    * @param id - The ID of the authenticated source User that will follow the List.
    * @param request_body - The request_body for followList
    * @param request_options - Customize the options for this request
    */
    followList: (
      id: string,
      request_body: TwitterBody<followList>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<followList>> =>
      rest<TwitterResponse<followList>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/followed_lists`,
        request_body,
        method: "POST",
      }),

    /**
    * Unfollow List
    *

    * Causes the authenticated user to unfollow a specific List by its ID.
    * @param id - The ID of the authenticated source User that will unfollow the List.
    * @param list_id - The ID of the List to unfollow.
    * @param request_options - Customize the options for this request
    */
    unfollowList: (
      id: string,
      list_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unfollowList>> =>
      rest<TwitterResponse<unfollowList>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/followed_lists/${list_id}`,
        method: "DELETE",
      }),

    /**
    * Get followers
    *

    * Retrieves a list of Users who follow a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersFollowers
    * @param request_options - Customize the options for this request
    */
    getUsersFollowers: (
      id: string,
      params: TwitterParams<getUsersFollowers> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersFollowers>> =>
      paginate<TwitterResponse<getUsersFollowers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/followers`,
        params,
        method: "GET",
      }),

    /**
    * Get following
    *

    * Retrieves a list of Users followed by a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersFollowing
    * @param request_options - Customize the options for this request
    */
    getUsersFollowing: (
      id: string,
      params: TwitterParams<getUsersFollowing> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersFollowing>> =>
      paginate<TwitterResponse<getUsersFollowing>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/following`,
        params,
        method: "GET",
      }),

    /**
    * Follow User
    *

    * Causes the authenticated user to follow a specific user by their ID.
    * @param id - The ID of the authenticated source User that is requesting to follow the target User.
    * @param request_body - The request_body for followUser
    * @param request_options - Customize the options for this request
    */
    followUser: (
      id: string,
      request_body: TwitterBody<followUser>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<followUser>> =>
      rest<TwitterResponse<followUser>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/following`,
        request_body,
        method: "POST",
      }),

    /**
    * Get liked Posts
    *

    * Retrieves a list of Posts liked by a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersLikedPosts
    * @param request_options - Customize the options for this request
    */
    getUsersLikedPosts: (
      id: string,
      params: TwitterParams<getUsersLikedPosts> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersLikedPosts>> =>
      paginate<TwitterResponse<getUsersLikedPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/liked_tweets`,
        params,
        method: "GET",
      }),

    /**
    * Like Post
    *

    * Causes the authenticated user to Like a specific Post by its ID.
    * @param id - The ID of the authenticated source User that is requesting to like the Post.
    * @param request_body - The request_body for likePost
    * @param request_options - Customize the options for this request
    */
    likePost: (
      id: string,
      request_body: TwitterBody<likePost>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<likePost>> =>
      rest<TwitterResponse<likePost>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/likes`,
        request_body,
        method: "POST",
      }),

    /**
    * Unlike Post
    *

    * Causes the authenticated user to Unlike a specific Post by its ID.
    * @param id - The ID of the authenticated source User that is requesting to unlike the Post.
    * @param tweet_id - The ID of the Post that the User is requesting to unlike.
    * @param request_options - Customize the options for this request
    */
    unlikePost: (
      id: string,
      tweet_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unlikePost>> =>
      rest<TwitterResponse<unlikePost>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/likes/${tweet_id}`,
        method: "DELETE",
      }),

    /**
    * Get List memberships
    *

    * Retrieves a list of Lists that a specific User is a member of by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersListMemberships
    * @param request_options - Customize the options for this request
    */
    getUsersListMemberships: (
      id: string,
      params: TwitterParams<getUsersListMemberships> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersListMemberships>> =>
      paginate<TwitterResponse<getUsersListMemberships>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/list_memberships`,
        params,
        method: "GET",
      }),

    /**
    * Get mentions
    *

    * Retrieves a list of Posts that mention a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersMentions
    * @param request_options - Customize the options for this request
    */
    getUsersMentions: (
      id: string,
      params: TwitterParams<getUsersMentions> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersMentions>> =>
      paginate<TwitterResponse<getUsersMentions>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/mentions`,
        params,
        method: "GET",
      }),

    /**
    * Get muting
    *

    * Retrieves a list of Users muted by the authenticated user.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param params - The params for getUsersMuting
    * @param request_options - Customize the options for this request
    */
    getUsersMuting: (
      id: string,
      params: TwitterParams<getUsersMuting> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersMuting>> =>
      paginate<TwitterResponse<getUsersMuting>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/muting`,
        params,
        method: "GET",
      }),

    /**
    * Mute User
    *

    * Causes the authenticated user to mute a specific User by their ID.
    * @param id - The ID of the authenticated source User that is requesting to mute the target User.
    * @param request_body - The request_body for muteUser
    * @param request_options - Customize the options for this request
    */
    muteUser: (
      id: string,
      request_body: TwitterBody<muteUser>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<muteUser>> =>
      rest<TwitterResponse<muteUser>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/muting`,
        request_body,
        method: "POST",
      }),

    /**
    * Get owned Lists
    *

    * Retrieves a list of Lists owned by a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersOwnedLists
    * @param request_options - Customize the options for this request
    */
    getUsersOwnedLists: (
      id: string,
      params: TwitterParams<getUsersOwnedLists> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersOwnedLists>> =>
      paginate<TwitterResponse<getUsersOwnedLists>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/owned_lists`,
        params,
        method: "GET",
      }),

    /**
    * Get pinned Lists
    *

    * Retrieves a list of Lists pinned by the authenticated user.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param params - The params for getUsersPinnedLists
    * @param request_options - Customize the options for this request
    */
    getUsersPinnedLists: (
      id: string,
      params: TwitterParams<getUsersPinnedLists> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersPinnedLists>> =>
      rest<TwitterResponse<getUsersPinnedLists>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/pinned_lists`,
        params,
        method: "GET",
      }),

    /**
    * Pin List
    *

    * Causes the authenticated user to pin a specific List by its ID.
    * @param id - The ID of the authenticated source User that will pin the List.
    * @param request_body - The request_body for pinList
    * @param request_options - Customize the options for this request
    */
    pinList: (
      id: string,
      request_body: TwitterBody<pinList>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<pinList>> =>
      rest<TwitterResponse<pinList>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/pinned_lists`,
        request_body,
        method: "POST",
      }),

    /**
    * Unpin List
    *

    * Causes the authenticated user to unpin a specific List by its ID.
    * @param id - The ID of the authenticated source User for whom to return results.
    * @param list_id - The ID of the List to unpin.
    * @param request_options - Customize the options for this request
    */
    unpinList: (
      id: string,
      list_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unpinList>> =>
      rest<TwitterResponse<unpinList>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/pinned_lists/${list_id}`,
        method: "DELETE",
      }),

    /**
    * Get user public keys
    *

    * Returns the public keys and Juicebox configuration for the specified user.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersPublicKey
    * @param request_options - Customize the options for this request
    */
    getUsersPublicKey: (
      id: string,
      params: TwitterParams<getUsersPublicKey> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsersPublicKey>> =>
      rest<TwitterResponse<getUsersPublicKey>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/public_keys`,
        params,
        method: "GET",
      }),

    /**
    * Repost Post
    *

    * Causes the authenticated user to repost a specific Post by its ID.
    * @param id - The ID of the authenticated source User that is requesting to repost the Post.
    * @param request_body - The request_body for repostPost
    * @param request_options - Customize the options for this request
    */
    repostPost: (
      id: string,
      request_body: TwitterBody<repostPost>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<repostPost>> =>
      rest<TwitterResponse<repostPost>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/retweets`,
        request_body,
        method: "POST",
      }),

    /**
    * Unrepost Post
    *

    * Causes the authenticated user to unrepost a specific Post by its ID.
    * @param id - The ID of the authenticated source User that is requesting to repost the Post.
    * @param source_tweet_id - The ID of the Post that the User is requesting to unretweet.
    * @param request_options - Customize the options for this request
    */
    unrepostPost: (
      id: string,
      source_tweet_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unrepostPost>> =>
      rest<TwitterResponse<unrepostPost>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/retweets/${source_tweet_id}`,
        method: "DELETE",
      }),

    /**
    * Get Timeline
    *

    * Retrieves a reverse chronological list of Posts in the authenticated User’s Timeline.
    * @param id - The ID of the authenticated source User to list Reverse Chronological Timeline Posts of.
    * @param params - The params for getUsersTimeline
    * @param request_options - Customize the options for this request
    */
    getUsersTimeline: (
      id: string,
      params: TwitterParams<getUsersTimeline> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersTimeline>> =>
      paginate<TwitterResponse<getUsersTimeline>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/timelines/reverse_chronological`,
        params,
        method: "GET",
      }),

    /**
    * Get Posts
    *

    * Retrieves a list of posts authored by a specific User by their ID.
    * @param id - The ID of the User to lookup.
    * @param params - The params for getUsersPosts
    * @param request_options - Customize the options for this request
    */
    getUsersPosts: (
      id: string,
      params: TwitterParams<getUsersPosts> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getUsersPosts>> =>
      paginate<TwitterResponse<getUsersPosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/tweets`,
        params,
        method: "GET",
      }),

    /**
    * Unfollow User
    *

    * Causes the authenticated user to unfollow a specific user by their ID.
    * @param source_user_id - The ID of the authenticated source User that is requesting to unfollow the target User.
    * @param target_user_id - The ID of the User that the source User is requesting to unfollow.
    * @param request_options - Customize the options for this request
    */
    unfollowUser: (
      source_user_id: string,
      target_user_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unfollowUser>> =>
      rest<TwitterResponse<unfollowUser>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${source_user_id}/following/${target_user_id}`,
        method: "DELETE",
      }),

    /**
    * Unmute User
    *

    * Causes the authenticated user to unmute a specific user by their ID.
    * @param source_user_id - The ID of the authenticated source User that is requesting to unmute the target User.
    * @param target_user_id - The ID of the User that the source User is requesting to unmute.
    * @param request_options - Customize the options for this request
    */
    unmuteUser: (
      source_user_id: string,
      target_user_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<unmuteUser>> =>
      rest<TwitterResponse<unmuteUser>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${source_user_id}/muting/${target_user_id}`,
        method: "DELETE",
      }),
  };
  /**
   * accountactivity
   *
   * accountactivity API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly accountactivity = {
    /**
    * Get subscription count
    *

    * Retrieves a count of currently active Account Activity subscriptions.
    * @param request_options - Customize the options for this request
    */
    getAccountActivitySubscriptionCount: (
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getAccountActivitySubscriptionCount>> =>
      rest<TwitterResponse<getAccountActivitySubscriptionCount>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/account_activity/subscriptions/count`,
        method: "GET",
      }),

    /**
    * Validate subscription
    *

    * Checks a user’s Account Activity subscription for a given webhook.
    * @param webhook_id - The webhook ID to check subscription against.
    * @param request_options - Customize the options for this request
    */
    validateAccountActivitySubscription: (
      webhook_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<validateAccountActivitySubscription>> =>
      rest<TwitterResponse<validateAccountActivitySubscription>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/account_activity/webhooks/${webhook_id}/subscriptions/all`,
        method: "GET",
      }),

    /**
    * Create subscription
    *

    * Creates an Account Activity subscription for the user and the given webhook.
    * @param webhook_id - The webhook ID to check subscription against.
    * @param request_body - The request_body for createAccountActivitySubscription
    * @param request_options - Customize the options for this request
    */
    createAccountActivitySubscription: (
      webhook_id: string,
      request_body: TwitterBody<createAccountActivitySubscription>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createAccountActivitySubscription>> =>
      rest<TwitterResponse<createAccountActivitySubscription>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/account_activity/webhooks/${webhook_id}/subscriptions/all`,
        request_body,
        method: "POST",
      }),

    /**
    * Get subscriptions
    *

    * Retrieves a list of all active subscriptions for a given webhook.
    * @param webhook_id - The webhook ID to pull subscriptions for.
    * @param request_options - Customize the options for this request
    */
    getAccountActivitySubscriptions: (
      webhook_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getAccountActivitySubscriptions>> =>
      rest<TwitterResponse<getAccountActivitySubscriptions>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/account_activity/webhooks/${webhook_id}/subscriptions/all/list`,
        method: "GET",
      }),

    /**
    * Delete subscription
    *

    * Deletes an Account Activity subscription for the given webhook and user ID.
    * @param webhook_id - The webhook ID to check subscription against.
    * @param user_id - User ID to unsubscribe from.
    * @param request_options - Customize the options for this request
    */
    deleteAccountActivitySubscription: (
      webhook_id: string,
      user_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteAccountActivitySubscription>> =>
      rest<TwitterResponse<deleteAccountActivitySubscription>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/account_activity/webhooks/${webhook_id}/subscriptions/${user_id}/all`,
        method: "DELETE",
      }),
  };
  /**
   * activity
   *
   * activity API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly activity = {
    /**
    * Activity Stream
    *

    * Stream of X Activities
    * @param params - The params for activityStream
    * @param request_options - Customize the options for this request
    */
    activityStream: (
      params: TwitterParams<activityStream> = {},
      request_options?: Partial<RequestOptions>
    ): AsyncGenerator<TwitterResponse<activityStream>> =>
      stream<TwitterResponse<activityStream>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/activity/stream`,
        params,
        method: "GET",
      }),

    /**
    * Delete X activity subscriptions by IDs
    *

    * Deletes multiple subscriptions for X activity events by their IDs
    * @param params - The params for deleteActivitySubscriptionsByIds
    * @param request_options - Customize the options for this request
    */
    deleteActivitySubscriptionsByIds: (
      params: TwitterParams<deleteActivitySubscriptionsByIds>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteActivitySubscriptionsByIds>> =>
      rest<TwitterResponse<deleteActivitySubscriptionsByIds>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/activity/subscriptions`,
        params,
        method: "DELETE",
      }),

    /**
    * Get X activity subscriptions
    *

    * Get a list of active subscriptions for XAA
    * @param params - The params for getActivitySubscriptions
    * @param request_options - Customize the options for this request
    */
    getActivitySubscriptions: (
      params: TwitterParams<getActivitySubscriptions> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getActivitySubscriptions>> =>
      paginate<TwitterResponse<getActivitySubscriptions>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/activity/subscriptions`,
        params,
        method: "GET",
      }),

    /**
    * Create X activity subscription
    *

    * Creates a subscription for an X activity event
    * @param request_body - The request_body for createActivitySubscription
    * @param request_options - Customize the options for this request
    */
    createActivitySubscription: (
      request_body: TwitterBody<createActivitySubscription>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createActivitySubscription>> =>
      rest<TwitterResponse<createActivitySubscription>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/activity/subscriptions`,
        request_body,
        method: "POST",
      }),

    /**
    * Deletes X activity subscription
    *

    * Deletes a subscription for an X activity event
    * @param subscription_id - The ID of the subscription to delete.
    * @param request_options - Customize the options for this request
    */
    deleteActivitySubscription: (
      subscription_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteActivitySubscription>> =>
      rest<TwitterResponse<deleteActivitySubscription>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/activity/subscriptions/${subscription_id}`,
        method: "DELETE",
      }),

    /**
    * Update X activity subscription
    *

    * Updates a subscription for an X activity event
    * @param subscription_id - The ID of the subscription to update.
    * @param request_body - The request_body for updateActivitySubscription
    * @param request_options - Customize the options for this request
    */
    updateActivitySubscription: (
      subscription_id: string,
      request_body: TwitterBody<updateActivitySubscription>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<updateActivitySubscription>> =>
      rest<TwitterResponse<updateActivitySubscription>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/activity/subscriptions/${subscription_id}`,
        request_body,
        method: "PUT",
      }),
  };
  /**
   * chat
   *
   * chat API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly chat = {
    /**
    * Get Chat Conversations
    *

    * Retrieves a list of Chat conversations for the authenticated user's inbox.
    * @param params - The params for getChatConversations
    * @param request_options - Customize the options for this request
    */
    getChatConversations: (
      params: TwitterParams<getChatConversations> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getChatConversations>> =>
      paginate<TwitterResponse<getChatConversations>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations`,
        params,
        method: "GET",
      }),

    /**
    * Create Chat Group Conversation
    *

    * Creates a new encrypted Chat group conversation on behalf of the authenticated user.
    * @param request_body - The request_body for createChatConversation
    * @param request_options - Customize the options for this request
    */
    createChatConversation: (
      request_body: TwitterBody<createChatConversation>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createChatConversation>> =>
      rest<TwitterResponse<createChatConversation>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/group`,
        request_body,
        method: "POST",
      }),

    /**
    * Initialize Chat Group
    *

    * Initializes a new XChat group conversation and returns a unique conversation ID.

This endpoint is the first step in creating a group chat. The returned conversation_id 
should be used in subsequent calls to POST /chat/conversations/group to fully create and 
configure the group with members, admins, encryption keys, and other settings.

**Workflow:**
1. Call this endpoint to get a `conversation_id`
2. Use that `conversation_id` when calling `POST /chat/conversations/group` to create the group

**Authentication:**
- Requires OAuth 1.0a User Context or OAuth 2.0 User Context
- Required scope: `dm.write`

    * @param request_options - Customize the options for this request
    */
    initializeChatGroup: (
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<initializeChatGroup>> =>
      rest<TwitterResponse<initializeChatGroup>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/group/initialize`,
        method: "POST",
      }),

    /**
    * Initialize Conversation Keys
    *

    * Initializes encryption keys for a Chat conversation. This is the first step
before sending messages in a new 1:1 conversation.

For 1:1 conversations, provide the recipient's user ID as the conversation_id.
The server constructs the canonical conversation ID from the authenticated user
and recipient.

The request body must contain the conversation key version and participant keys
(the conversation key encrypted for each participant using their public key).

**Workflow (1:1 conversation):**
1. Generate a conversation key using the SDK
2. Encrypt the key for both participants using their public keys
3. Call this endpoint to register the keys
4. Send messages using `POST /chat/conversations/{id}/messages`

**Authentication:**
- Requires OAuth 1.0a User Context or OAuth 2.0 User Context
- Required scopes: `tweet.read`, `users.read`, `dm.write`

    * @param id - The recipient's user ID for a 1:1 conversation, or a group conversation ID (prefixed with 'g').
    * @param request_body - The request_body for initializeChatConversationKeys
    * @param request_options - Customize the options for this request
    */
    initializeChatConversationKeys: (
      id: string,
      request_body: TwitterBody<initializeChatConversationKeys>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<initializeChatConversationKeys>> =>
      rest<TwitterResponse<initializeChatConversationKeys>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/${id}/keys`,
        request_body,
        method: "POST",
      }),

    /**
    * Add members to a Chat group conversation
    *

    * Adds one or more members to an existing encrypted Chat group conversation, rotating the conversation key.
    * @param id - The Chat group conversation ID.
    * @param request_body - The request_body for addChatGroupMembers
    * @param request_options - Customize the options for this request
    */
    addChatGroupMembers: (
      id: string,
      request_body: TwitterBody<addChatGroupMembers>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<addChatGroupMembers>> =>
      rest<TwitterResponse<addChatGroupMembers>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/${id}/members`,
        request_body,
        method: "POST",
      }),

    /**
    * Send Chat Message
    *

    * Sends an encrypted message to a specific Chat conversation. For 1:1 conversations, provide the recipient's user ID; the server constructs the canonical conversation ID from the authenticated user and recipient.
    * @param id - The recipient's user ID for a 1:1 conversation, or a group conversation ID (prefixed with 'g').
    * @param request_body - The request_body for sendChatMessage
    * @param request_options - Customize the options for this request
    */
    sendChatMessage: (
      id: string,
      request_body: TwitterBody<sendChatMessage>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<sendChatMessage>> =>
      rest<TwitterResponse<sendChatMessage>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/${id}/messages`,
        request_body,
        method: "POST",
      }),

    /**
    * Mark Conversation as Read
    *

    * Marks a specific Chat conversation as read on behalf of the authenticated user. For 1:1 conversations, provide the recipient's user ID; the server constructs the canonical conversation ID from the authenticated user and recipient.
    * @param id - The recipient's user ID for a 1:1 conversation, or a group conversation ID (prefixed with 'g').
    * @param request_body - The request_body for markChatConversationRead
    * @param request_options - Customize the options for this request
    */
    markChatConversationRead: (
      id: string,
      request_body: TwitterBody<markChatConversationRead>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<markChatConversationRead>> =>
      rest<TwitterResponse<markChatConversationRead>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/${id}/read`,
        request_body,
        method: "POST",
      }),

    /**
    * Send Typing Indicator
    *

    * Sends a typing indicator to a specific Chat conversation on behalf of the authenticated user. For 1:1 conversations, provide the recipient's user ID; the server constructs the canonical conversation ID from the authenticated user and recipient.
    * @param id - The recipient's user ID for a 1:1 conversation, or a group conversation ID (prefixed with 'g').
    * @param request_options - Customize the options for this request
    */
    sendChatTypingIndicator: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<sendChatTypingIndicator>> =>
      rest<TwitterResponse<sendChatTypingIndicator>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/conversations/${id}/typing`,
        method: "POST",
      }),

    /**
    * Initialize Chat Media Upload
    *

    * Initializes an XChat media upload session.
    * @param request_body - The request_body for chatMediaUploadInitialize
    * @param request_options - Customize the options for this request
    */
    chatMediaUploadInitialize: (
      request_body: TwitterBody<chatMediaUploadInitialize>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<chatMediaUploadInitialize>> =>
      rest<TwitterResponse<chatMediaUploadInitialize>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/media/upload/initialize`,
        request_body,
        method: "POST",
      }),

    /**
    * Append Chat Media Upload
    *

    * Appends media data to an XChat upload session.
    * @param id - The session/resume id from initialize.
    * @param request_body - The request_body for chatMediaUploadAppend
    * @param request_options - Customize the options for this request
    */
    chatMediaUploadAppend: (
      id: string,
      request_body: TwitterBody<chatMediaUploadAppend>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<chatMediaUploadAppend>> =>
      rest<TwitterResponse<chatMediaUploadAppend>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/media/upload/${id}/append`,
        request_body,
        method: "POST",
      }),

    /**
    * Finalize Chat Media Upload
    *

    * Finalizes an XChat media upload session.
    * @param id - The session/resume id from initialize.
    * @param request_body - The request_body for chatMediaUploadFinalize
    * @param request_options - Customize the options for this request
    */
    chatMediaUploadFinalize: (
      id: string,
      request_body: TwitterBody<chatMediaUploadFinalize>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<chatMediaUploadFinalize>> =>
      rest<TwitterResponse<chatMediaUploadFinalize>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/media/upload/${id}/finalize`,
        request_body,
        method: "POST",
      }),

    /**
    * Download Chat Media
    *

    * Downloads encrypted media bytes from an XChat conversation. The response body contains raw binary bytes. For 1:1 conversations, provide the recipient's user ID; the server constructs the canonical conversation ID from the authenticated user and recipient.
    * @param id - The recipient's user ID for a 1:1 conversation, or a group conversation ID (prefixed with 'g').
    * @param media_hash_key - The media hash key returned from the upload initialize step.
    * @param request_options - Customize the options for this request
    */
    chatMediaDownload: (
      id: string,
      media_hash_key: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<chatMediaDownload>> =>
      rest<TwitterResponse<chatMediaDownload>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/chat/media/${id}/${media_hash_key}`,
        method: "GET",
      }),

    /**
    * Add public key
    *

    * Registers a user's public key for X Chat encryption.
    * @param id - The ID of the requesting user.
    * @param request_body - The request_body for addUserPublicKey
    * @param request_options - Customize the options for this request
    */
    addUserPublicKey: (
      id: string,
      request_body: TwitterBody<addUserPublicKey>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<addUserPublicKey>> =>
      rest<TwitterResponse<addUserPublicKey>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/${id}/public_keys`,
        request_body,
        method: "POST",
      }),
  };
  /**
   * communities
   *
   * communities API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly communities = {
    /**
    * Search Communities
    *

    * Retrieves a list of Communities matching the specified search query.
    * @param params - The params for searchCommunities
    * @param request_options - Customize the options for this request
    */
    searchCommunities: (
      params: TwitterParams<searchCommunities>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<searchCommunities>> =>
      paginate<TwitterResponse<searchCommunities>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/communities/search`,
        params,
        method: "GET",
      }),

    /**
    * Get Community by ID
    *

    * Retrieves details of a specific Community by its ID.
    * @param id - The ID of the Community.
    * @param params - The params for getCommunitiesById
    * @param request_options - Customize the options for this request
    */
    getCommunitiesById: (
      id: string,
      params: TwitterParams<getCommunitiesById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getCommunitiesById>> =>
      rest<TwitterResponse<getCommunitiesById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/communities/${id}`,
        params,
        method: "GET",
      }),
  };
  /**
   * directmessages
   *
   * directmessages API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly directmessages = {
    /**
    * Create DM conversation
    *

    * Initiates a new direct message conversation with specified participants.
    * @param request_body - The request_body for createDirectMessagesConversation
    * @param request_options - Customize the options for this request
    */
    createDirectMessagesConversation: (
      request_body: TwitterBody<createDirectMessagesConversation>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createDirectMessagesConversation>> =>
      rest<TwitterResponse<createDirectMessagesConversation>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_conversations`,
        request_body,
        method: "POST",
      }),

    /**
    * Download DM Media
    *

    * Downloads media attached to a legacy Direct Message. The requesting user must be a participant in the conversation containing the specified DM event. The response body contains raw binary bytes.
    * @param dm_id - The unique identifier of the Direct Message event containing the media.
    * @param media_id - The unique identifier of the media attached to the Direct Message.
    * @param resource_id - The resource identifier of the media file, including file extension (e.g. 'hVJQTwig.jpg').
    * @param request_options - Customize the options for this request
    */
    dmConversationsMediaDownload: (
      dm_id: string,
      media_id: string,
      resource_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<dmConversationsMediaDownload>> =>
      rest<TwitterResponse<dmConversationsMediaDownload>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_conversations/media/${dm_id}/${media_id}/${resource_id}`,
        method: "GET",
      }),

    /**
    * Get DM events for a DM conversation
    *

    * Retrieves direct message events for a specific conversation.
    * @param participant_id - The ID of the participant user for the One to One DM conversation.
    * @param params - The params for getDirectMessagesEventsByParticipantId
    * @param request_options - Customize the options for this request
    */
    getDirectMessagesEventsByParticipantId: (
      participant_id: string,
      params: TwitterParams<getDirectMessagesEventsByParticipantId> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<
      TwitterResponse<getDirectMessagesEventsByParticipantId>
    > =>
      paginate<TwitterResponse<getDirectMessagesEventsByParticipantId>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_conversations/with/${participant_id}/dm_events`,
        params,
        method: "GET",
      }),

    /**
    * Create DM message by participant ID
    *

    * Sends a new direct message to a specific participant by their ID.
    * @param participant_id - The ID of the recipient user that will receive the DM.
    * @param request_body - The request_body for createDirectMessagesByParticipantId
    * @param request_options - Customize the options for this request
    */
    createDirectMessagesByParticipantId: (
      participant_id: string,
      request_body: TwitterBody<createDirectMessagesByParticipantId>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createDirectMessagesByParticipantId>> =>
      rest<TwitterResponse<createDirectMessagesByParticipantId>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_conversations/with/${participant_id}/messages`,
        request_body,
        method: "POST",
      }),

    /**
    * Create DM message by conversation ID
    *

    * Sends a new direct message to a specific conversation by its ID.
    * @param dm_conversation_id - The DM Conversation ID.
    * @param request_body - The request_body for createDirectMessagesByConversationId
    * @param request_options - Customize the options for this request
    */
    createDirectMessagesByConversationId: (
      dm_conversation_id: string,
      request_body: TwitterBody<createDirectMessagesByConversationId>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createDirectMessagesByConversationId>> =>
      rest<TwitterResponse<createDirectMessagesByConversationId>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_conversations/${dm_conversation_id}/messages`,
        request_body,
        method: "POST",
      }),

    /**
    * Get DM events for a DM conversation
    *

    * Retrieves direct message events for a specific conversation.
    * @param id - The DM conversation ID.
    * @param params - The params for getDirectMessagesEventsByConversationId
    * @param request_options - Customize the options for this request
    */
    getDirectMessagesEventsByConversationId: (
      id: string,
      params: TwitterParams<getDirectMessagesEventsByConversationId> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<
      TwitterResponse<getDirectMessagesEventsByConversationId>
    > =>
      paginate<TwitterResponse<getDirectMessagesEventsByConversationId>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_conversations/${id}/dm_events`,
        params,
        method: "GET",
      }),

    /**
    * Get DM events
    *

    * Retrieves a list of recent direct message events across all conversations.
    * @param params - The params for getDirectMessagesEvents
    * @param request_options - Customize the options for this request
    */
    getDirectMessagesEvents: (
      params: TwitterParams<getDirectMessagesEvents> = {},
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<getDirectMessagesEvents>> =>
      paginate<TwitterResponse<getDirectMessagesEvents>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_events`,
        params,
        method: "GET",
      }),

    /**
    * Delete DM event
    *

    * Deletes a specific direct message event by its ID, if owned by the authenticated user.
    * @param event_id - The ID of the direct-message event to delete.
    * @param request_options - Customize the options for this request
    */
    deleteDirectMessagesEvents: (
      event_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteDirectMessagesEvents>> =>
      rest<TwitterResponse<deleteDirectMessagesEvents>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_events/${event_id}`,
        method: "DELETE",
      }),

    /**
    * Get DM event by ID
    *

    * Retrieves details of a specific direct message event by its ID.
    * @param event_id - dm event id.
    * @param params - The params for getDirectMessagesEventsById
    * @param request_options - Customize the options for this request
    */
    getDirectMessagesEventsById: (
      event_id: string,
      params: TwitterParams<getDirectMessagesEventsById> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getDirectMessagesEventsById>> =>
      rest<TwitterResponse<getDirectMessagesEventsById>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/dm_events/${event_id}`,
        params,
        method: "GET",
      }),
  };
  /**
   * communitynotes
   *
   * communitynotes API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly communitynotes = {
    /**
    * Evaluate a Community Note
    *

    * Endpoint to evaluate a community note.
    * @param request_body - The request_body for evaluateCommunityNotes
    * @param request_options - Customize the options for this request
    */
    evaluateCommunityNotes: (
      request_body: TwitterBody<evaluateCommunityNotes>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<evaluateCommunityNotes>> =>
      rest<TwitterResponse<evaluateCommunityNotes>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/evaluate_note`,
        request_body,
        method: "POST",
      }),

    /**
    * Create a Community Note
    *

    * Creates a community note endpoint for LLM use case.
    * @param request_body - The request_body for createCommunityNotes
    * @param request_options - Customize the options for this request
    */
    createCommunityNotes: (
      request_body: TwitterBody<createCommunityNotes>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createCommunityNotes>> =>
      rest<TwitterResponse<createCommunityNotes>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/notes`,
        request_body,
        method: "POST",
      }),

    /**
    * Search for Community Notes Written
    *

    * Returns all the community notes written by the user.
    * @param params - The params for searchCommunityNotesWritten
    * @param request_options - Customize the options for this request
    */
    searchCommunityNotesWritten: (
      params: TwitterParams<searchCommunityNotesWritten>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<searchCommunityNotesWritten>> =>
      paginate<TwitterResponse<searchCommunityNotesWritten>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/notes/search/notes_written`,
        params,
        method: "GET",
      }),

    /**
    * Search for Posts Eligible for Community Notes
    *

    * Returns all the posts that are eligible for community notes.
    * @param params - The params for searchEligiblePosts
    * @param request_options - Customize the options for this request
    */
    searchEligiblePosts: (
      params: TwitterParams<searchEligiblePosts>,
      request_options?: Partial<RequestOptions>
    ): TwitterPaginatedResponse<TwitterResponse<searchEligiblePosts>> =>
      paginate<TwitterResponse<searchEligiblePosts>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/notes/search/posts_eligible_for_notes`,
        params,
        method: "GET",
      }),

    /**
    * Delete a Community Note
    *

    * Deletes a community note.
    * @param id - The community note id to delete.
    * @param request_options - Customize the options for this request
    */
    deleteCommunityNotes: (
      id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteCommunityNotes>> =>
      rest<TwitterResponse<deleteCommunityNotes>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/notes/${id}`,
        method: "DELETE",
      }),
  };
  /**
   * trends
   *
   * trends API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly trends = {
    /**
    * Get Trends by WOEID
    *

    * Retrieves trending topics for a specific location identified by its WOEID.
    * @param woeid - The WOEID of the place to lookup a trend for.
    * @param params - The params for getTrendsByWoeid
    * @param request_options - Customize the options for this request
    */
    getTrendsByWoeid: (
      woeid: string,
      params: TwitterParams<getTrendsByWoeid> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getTrendsByWoeid>> =>
      rest<TwitterResponse<getTrendsByWoeid>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/trends/by/woeid/${woeid}`,
        params,
        method: "GET",
      }),

    /**
    * Get personalized Trends
    *

    * Retrieves personalized trending topics for the authenticated user.
    * @param params - The params for getTrendsPersonalizedTrends
    * @param request_options - Customize the options for this request
    */
    getTrendsPersonalizedTrends: (
      params: TwitterParams<getTrendsPersonalizedTrends> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getTrendsPersonalizedTrends>> =>
      rest<TwitterResponse<getTrendsPersonalizedTrends>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/users/personalized_trends`,
        params,
        method: "GET",
      }),
  };
  /**
   * webhooks
   *
   * webhooks API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly webhooks = {
    /**
    * Get stream links
    *

    * Get a list of webhook links associated with a filtered stream ruleset.
    * @param request_options - Customize the options for this request
    */
    getWebhooksStreamLinks: (
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getWebhooksStreamLinks>> =>
      rest<TwitterResponse<getWebhooksStreamLinks>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/webhooks`,
        method: "GET",
      }),

    /**
    * Delete stream link
    *

    * Deletes a link from FilteredStream events to the given webhook.
    * @param webhook_id - The webhook ID to link to your FilteredStream ruleset.
    * @param request_options - Customize the options for this request
    */
    deleteWebhooksStreamLink: (
      webhook_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteWebhooksStreamLink>> =>
      rest<TwitterResponse<deleteWebhooksStreamLink>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/webhooks/${webhook_id}`,
        method: "DELETE",
      }),

    /**
    * Create stream link
    *

    * Creates a link to deliver FilteredStream events to the given webhook.
    * @param webhook_id - The webhook ID to link to your FilteredStream ruleset.
    * @param params - The params for createWebhooksStreamLink
    * @param request_options - Customize the options for this request
    */
    createWebhooksStreamLink: (
      webhook_id: string,
      params: TwitterParams<createWebhooksStreamLink> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createWebhooksStreamLink>> =>
      rest<TwitterResponse<createWebhooksStreamLink>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/tweets/search/webhooks/${webhook_id}`,
        params,
        method: "POST",
      }),

    /**
    * Get webhook
    *

    * Get a list of webhook configs associated with a client app.
    * @param params - The params for getWebhooks
    * @param request_options - Customize the options for this request
    */
    getWebhooks: (
      params: TwitterParams<getWebhooks> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getWebhooks>> =>
      rest<TwitterResponse<getWebhooks>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/webhooks`,
        params,
        method: "GET",
      }),

    /**
    * Create webhook
    *

    * Creates a new webhook configuration.
    * @param request_body - The request_body for createWebhooks
    * @param request_options - Customize the options for this request
    */
    createWebhooks: (
      request_body: TwitterBody<createWebhooks>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createWebhooks>> =>
      rest<TwitterResponse<createWebhooks>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/webhooks`,
        request_body,
        method: "POST",
      }),

    /**
    * Create replay job for webhook
    *

    * Creates a replay job to retrieve events from up to the past 24 hours for all events delivered or attempted to be delivered to the webhook.
    * @param request_body - The request_body for createWebhookReplayJob
    * @param request_options - Customize the options for this request
    */
    createWebhookReplayJob: (
      request_body: TwitterBody<createWebhookReplayJob>,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<createWebhookReplayJob>> =>
      rest<TwitterResponse<createWebhookReplayJob>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/webhooks/replay`,
        request_body,
        method: "POST",
      }),

    /**
    * Delete webhook
    *

    * Deletes an existing webhook configuration.
    * @param webhook_id - The ID of the webhook to delete.
    * @param request_options - Customize the options for this request
    */
    deleteWebhooks: (
      webhook_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<deleteWebhooks>> =>
      rest<TwitterResponse<deleteWebhooks>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/webhooks/${webhook_id}`,
        method: "DELETE",
      }),

    /**
    * Validate webhook
    *

    * Triggers a CRC check for a given webhook.
    * @param webhook_id - The ID of the webhook to check.
    * @param request_options - Customize the options for this request
    */
    validateWebhooks: (
      webhook_id: string,
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<validateWebhooks>> =>
      rest<TwitterResponse<validateWebhooks>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/webhooks/${webhook_id}`,
        method: "PUT",
      }),
  };
  /**
   * usage
   *
   * usage API
   *
   * Find out more
   * https://developer.x.com
   */
  public readonly usage = {
    /**
    * Get usage
    *

    * Retrieves usage statistics for Posts over a specified number of days.
    * @param params - The params for getUsage
    * @param request_options - Customize the options for this request
    */
    getUsage: (
      params: TwitterParams<getUsage> = {},
      request_options?: Partial<RequestOptions>
    ): Promise<TwitterResponse<getUsage>> =>
      rest<TwitterResponse<getUsage>>({
        auth: this.#auth,
        ...this.#defaultRequestOptions,
        ...request_options,
        endpoint: `/2/usage/tweets`,
        params,
        method: "GET",
      }),
  };
}
