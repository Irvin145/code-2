import React from 'react';
import type { Serialized } from '@rocket.chat/core-typings';
import type { Method, OperationParams, OperationResult, PathPattern, UrlParams } from '@rocket.chat/rest-typings';
import type { ServerMethodName, ServerMethodParameters, ServerMethodReturn } from '@rocket.chat/ui-contexts';
import { ServerContext } from '@rocket.chat/ui-contexts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const MockedServerContext = ({
	handleRequest,
	handleMethod,
	children,
}: {
	handleRequest: <TMethod extends Method, TPathPattern extends PathPattern>(args: {
		method: TMethod;
		pathPattern: TPathPattern;
		keys: UrlParams<TPathPattern>;
		params: OperationParams<TMethod, TPathPattern>;
	}) => Promise<Serialized<OperationResult<TMethod, TPathPattern>>>;
	handleMethod: <MethodName extends ServerMethodName>(
		_methodName: MethodName,
		..._args: ServerMethodParameters<MethodName>
	) => Promise<ServerMethodReturn<MethodName>>;
	children: React.ReactNode;
}): any => {
	const [queryClient] = React.useState(() => new QueryClient());
	return (
		<ServerContext.Provider
			value={
				{
					absoluteUrl: (path: string) => `http://localhost:3000/${path}`,
					callMethod: <MethodName extends ServerMethodName>(_methodName: MethodName, ..._args: ServerMethodParameters<MethodName>) => {
						console.log('callMethod');
						return handleMethod(_methodName, ..._args);
					},
					callEndpoint: async <TMethod extends Method, TPathPattern extends PathPattern>(args: {
						method: TMethod;
						pathPattern: TPathPattern;
						keys: UrlParams<TPathPattern>;
						params: OperationParams<TMethod, TPathPattern>;
					}) => {
						return handleRequest(args);
					},
				} as any
			}
		>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</ServerContext.Provider>
	);
};