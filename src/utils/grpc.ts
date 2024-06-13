import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js'
import { isHttpError } from 'http-errors'

export const handler = <Request, Response>(
  fn: (call: ServerUnaryCall<Request, Response>) => Promise<Response>
) => (call: ServerUnaryCall<Request, Response>, callback: sendUnaryData<Response>) => {
  try {
    fn(call)
      .then((response) => callback(null, response))
      .catch((error) => {
        if (isHttpError(error)) {
          error['code'] = error.statusCode
        }

        return callback(error, null)
      })
  } catch (error) {
    if (isHttpError(error)) {
      error['code'] = error.statusCode
    }
    
    callback(error, null)
  }
}
