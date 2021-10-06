// thaw-http-server-base/src/main.ts

import { createServer, IncomingMessage, ServerResponse, STATUS_CODES } from 'http';

import { Socket } from 'net';

export interface IHttpServerRequestContext {
	requestBody?: string;
}

export interface IHttpServerResponseData {
	statusCode?: number;
	responseBody?: unknown;
	isResponseBodyJson?: boolean; // Or: stringifyResponseBody
}

export type RequestHandlerType = (
	urlComponents: string[],
	context: IHttpServerRequestContext
) => Promise<IHttpServerResponseData>;

const createRequestHandlerMapKey = (httpMethod: string, numUrlComponents: number) =>
	`${httpMethod}/${numUrlComponents}`;

const lineEndingInResponse = '\r\n';

export class HttpServerBase {
	private readonly supportedHttpMethods: string[] = [];
	private readonly requestHandlerMap = new Map<string, RequestHandlerType>();

	protected addRequestHandler(
		httpMethod: string,
		numUrlComponents: number,
		fnHandler: RequestHandlerType
	): void {
		if (this.supportedHttpMethods.indexOf(httpMethod) < 0) {
			this.supportedHttpMethods.push(httpMethod);
		}

		this.requestHandlerMap.set(
			createRequestHandlerMapKey(httpMethod, numUrlComponents),
			fnHandler
		);
	}

	private constructRequestBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			try {
				let body = '';

				req.on('readable', function () {
					body += req.read();
				});

				req.on('end', function () {
					// TODO: Write a comment that explains the -4
					const trimmedBody = body.substring(0, body.length - 4);

					// console.log('The raw request body is:\n\n', body, '\n');
					// console.log(`The trimmed request body is [${trimmedBody}]\n`);

					resolve(trimmedBody);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	private respondWithStatusCode(
		res: ServerResponse,
		responseData: IHttpServerResponseData
	): void {
		const statusCode = responseData.statusCode || 200;
		const isSuccess = statusCode >= 200 && statusCode < 300;
		const responseWillHaveBody = isSuccess && responseData.responseBody;

		if (responseWillHaveBody && responseData.isResponseBodyJson) {
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
		}

		res.setHeader('Access-Control-Allow-Origin', '*'); // To support CORS (cross-origin resource sharing?)
		res.writeHead(statusCode);

		if (responseWillHaveBody) {
			res.write(`${responseData.responseBody}${lineEndingInResponse}`);
		}

		res.end();

		console.log('Response:', statusCode, STATUS_CODES[statusCode]);
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const httpMethod = req.method || 'GET'; // HTTP methods are expected to be in all caps

			console.log(`\nRequest: ${httpMethod} ${req.url}\n`);

			let responseData: IHttpServerResponseData;

			if (this.supportedHttpMethods.indexOf(httpMethod) < 0) {
				responseData = { statusCode: 405 }; // Method Not Allowed
			} else {
				const urlComponents = (req.url || '')
					.split('/')
					.filter((str: string) => str.length > 0);

				const fnHandler = this.requestHandlerMap.get(
					createRequestHandlerMapKey(httpMethod, urlComponents.length)
				);

				if (typeof fnHandler === 'undefined') {
					console.error(
						`Error: ${httpMethod} ${req.url} : Unsupported number of URL components.`
					);
					responseData = { statusCode: 400 }; // Bad Request
				} else {
					// const httpMethodsExpectingBodyInResponse = ['GET', 'POST']; // TODO: Add other methods?
					// const successfulResponseShouldHaveBody = httpMethodsExpectingBodyInResponse.indexOf(httpMethod) >= 0;
					let requestBody: string | undefined;

					if (['POST', 'PUT', 'PATCH'].indexOf(httpMethod) >= 0) {
						requestBody = await this.constructRequestBody(req);
					}

					responseData = await fnHandler(urlComponents, { requestBody });
				}
			}

			if (['GET', 'POST'].indexOf(httpMethod) < 0) {
				// TODO: Add other methods?
				responseData.responseBody = undefined;
			}

			this.respondWithStatusCode(res, responseData);
		} catch (error) {
			console.error('Exception caught:', typeof error, error);
			this.respondWithStatusCode(res, { statusCode: 500 }); // Internal Server Error
		}
	}

	public async listen(portParam?: number): Promise<void> {
		const server = createServer((req: IncomingMessage, res: ServerResponse) =>
			this.handleRequest(req, res)
		);

		server.on('clientError', (error: Error, socket: Socket): void => {
			console.error('HTTP client error: ', typeof error, error);
			socket.end(`HTTP/1.1 400 Bad Request${lineEndingInResponse}${lineEndingInResponse}`);
		});

		const port = portParam || 80;

		console.log(`The HTTP server is now listening on port ${port}`);

		server.listen(port); // 'await' would have no effect here.
	}
}
