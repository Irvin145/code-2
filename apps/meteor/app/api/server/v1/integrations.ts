import type { IIntegration, INewIncomingIntegration, INewOutgoingIntegration } from '@rocket.chat/core-typings';
import { Integrations, IntegrationHistory } from '@rocket.chat/models';
import {
	isIntegrationsCreateProps,
	isIntegrationsHistoryProps,
	isIntegrationsRemoveProps,
	isIntegrationsGetProps,
	isIntegrationsUpdateProps,
} from '@rocket.chat/rest-typings';
import { Match, check } from 'meteor/check';
import { Meteor } from 'meteor/meteor';
import type { Filter } from 'mongodb';

import { hasAtLeastOnePermissionAsync } from '../../../authorization/server/functions/hasPermission';
import {
	mountIntegrationHistoryQueryBasedOnPermissions,
	mountIntegrationQueryBasedOnPermissions,
} from '../../../integrations/server/lib/mountQueriesBasedOnPermission';
import { addIncomingIntegration } from '../../../integrations/server/methods/incoming/addIncomingIntegration';
import { deleteIncomingIntegration } from '../../../integrations/server/methods/incoming/deleteIncomingIntegration';
import { addOutgoingIntegration } from '../../../integrations/server/methods/outgoing/addOutgoingIntegration';
import { deleteOutgoingIntegration } from '../../../integrations/server/methods/outgoing/deleteOutgoingIntegration';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';
import { findOneIntegration } from '../lib/integrations';

API.v1.addRoute(
	'integrations.create',
	{ authRequired: true, validateParams: isIntegrationsCreateProps },
	{
		async post() {
			switch (this.bodyParams.type) {
				case 'webhook-outgoing':
					return API.v1.success({ integration: await addOutgoingIntegration(this.userId, this.bodyParams as INewOutgoingIntegration) });
				case 'webhook-incoming':
					return API.v1.success({ integration: await addIncomingIntegration(this.userId, this.bodyParams as INewIncomingIntegration) });
			}

			return API.v1.failure('Invalid integration type.');
		},
	},
);

API.v1.addRoute(
	'integrations.history',
	{ authRequired: true, validateParams: isIntegrationsHistoryProps },
	{
		async get() {
			const { userId, queryParams } = this;

			if (!(await hasAtLeastOnePermissionAsync(userId, ['manage-outgoing-integrations', 'manage-own-outgoing-integrations']))) {
				return API.v1.unauthorized();
			}

			if (!queryParams.id || queryParams.id.trim() === '') {
				return API.v1.failure('Invalid integration id.');
			}

			const { id } = queryParams;
			const { offset, count } = await getPaginationItems(this.queryParams);
			const { sort, fields: projection, query } = await this.parseJsonQuery();
			const ourQuery = Object.assign(await mountIntegrationHistoryQueryBasedOnPermissions(userId, id), query);

			const { cursor, totalCount } = IntegrationHistory.findPaginated(ourQuery, {
				sort: sort || { _updatedAt: -1 },
				skip: offset,
				limit: count,
				projection,
			});

			const [history, total] = await Promise.all([cursor.toArray(), totalCount]);

			return API.v1.success({
				history,
				offset,
				items: history.length,
				count: history.length,
				total,
			});
		},
	},
);

API.v1.addRoute(
	'integrations.list',
	{ authRequired: true },
	{
		async get() {
			if (
				!(await hasAtLeastOnePermissionAsync(this.userId, [
					'manage-outgoing-integrations',
					'manage-own-outgoing-integrations',
					'manage-incoming-integrations',
					'manage-own-incoming-integrations',
				]))
			) {
				return API.v1.unauthorized();
			}

			const { offset, count } = await getPaginationItems(this.queryParams);
			const { sort, fields: projection, query } = await this.parseJsonQuery();

			const ourQuery = Object.assign(await mountIntegrationQueryBasedOnPermissions(this.userId), query) as Filter<IIntegration>;

			const { cursor, totalCount } = Integrations.findPaginated(ourQuery, {
				sort: sort || { ts: -1 },
				skip: offset,
				limit: count,
				projection,
			});

			const [integrations, total] = await Promise.all([cursor.toArray(), totalCount]);

			return API.v1.success({
				integrations,
				offset,
				items: integrations.length,
				count: integrations.length,
				total,
			});
		},
	},
);

API.v1.addRoute(
	'integrations.remove',
	{ authRequired: true, validateParams: isIntegrationsRemoveProps },
	{
		async post() {
			if (
				!(await hasAtLeastOnePermissionAsync(this.userId, [
					'manage-outgoing-integrations',
					'manage-own-outgoing-integrations',
					'manage-incoming-integrations',
					'manage-own-incoming-integrations',
				]))
			) {
				return API.v1.unauthorized();
			}

			const { bodyParams } = this;

			let integration: IIntegration | null = null;
			switch (bodyParams.type) {
				case 'webhook-outgoing':
					if (!bodyParams.target_url && !bodyParams.integrationId) {
						return API.v1.failure('An integrationId or target_url needs to be provided.');
					}

					if (bodyParams.target_url) {
						integration = await Integrations.findOne({ urls: bodyParams.target_url });
					} else if (bodyParams.integrationId) {
						integration = await Integrations.findOne({ _id: bodyParams.integrationId });
					}

					if (!integration) {
						return API.v1.failure('No integration found.');
					}

					const outgoingId = integration._id;

					await deleteOutgoingIntegration(outgoingId, this.userId);

					return API.v1.success({
						integration,
					});
				case 'webhook-incoming':
					check(
						bodyParams,
						Match.ObjectIncluding({
							integrationId: String,
						}),
					);

					integration = await Integrations.findOne({ _id: bodyParams.integrationId });

					if (!integration) {
						return API.v1.failure('No integration found.');
					}

					const incomingId = integration._id;
					await deleteIncomingIntegration(incomingId, this.userId);

					return API.v1.success({
						integration,
					});
				default:
					return API.v1.failure('Invalid integration type.');
			}
		},
	},
);

API.v1.addRoute(
	'integrations.get',
	{ authRequired: true, validateParams: isIntegrationsGetProps },
	{
		async get() {
			const { integrationId, createdBy } = this.queryParams;
			if (!integrationId) {
				return API.v1.failure('The query parameter "integrationId" is required.');
			}

			return API.v1.success({
				integration: await findOneIntegration({
					userId: this.userId,
					integrationId,
					createdBy,
				}),
			});
		},
	},
);

API.v1.addRoute(
	'integrations.update',
	{ authRequired: true, validateParams: isIntegrationsUpdateProps },
	{
		async put() {
			const { bodyParams } = this;

			let integration;
			switch (bodyParams.type) {
				case 'webhook-outgoing':
					if (bodyParams.target_url) {
						integration = await Integrations.findOne({ urls: bodyParams.target_url });
					} else if (bodyParams.integrationId) {
						integration = await Integrations.findOne({ _id: bodyParams.integrationId });
					}

					if (!integration) {
						return API.v1.failure('No integration found.');
					}

					await Meteor.callAsync('updateOutgoingIntegration', integration._id, bodyParams);

					return API.v1.success({
						integration: await Integrations.findOne({ _id: integration._id }),
					});
				case 'webhook-incoming':
					integration = await Integrations.findOne({ _id: bodyParams.integrationId });

					if (!integration) {
						return API.v1.failure('No integration found.');
					}

					await Meteor.callAsync('updateIncomingIntegration', integration._id, bodyParams);

					return API.v1.success({
						integration: await Integrations.findOne({ _id: integration._id }),
					});
				default:
					return API.v1.failure('Invalid integration type.');
			}
		},
	},
);
