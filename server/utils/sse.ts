import type { Response } from 'express';
import type { Socket } from 'net';

const guardedSockets = new WeakSet<Socket>();
const guardedStreams = new WeakSet<Response>();
const closedStreams = new WeakSet<Response>();

export function isExpectedDisconnectError(error: NodeJS.ErrnoException) {
  return error.code === 'EOF'
    || error.code === 'ECONNRESET'
    || error.code === 'EPIPE'
    || error.code === 'ERR_STREAM_DESTROYED'
    || (error.syscall === 'write' && error.message === 'write EOF');
}

export function guardSocketError(socket: Socket | null | undefined) {
  if (!socket || guardedSockets.has(socket)) return;
  guardedSockets.add(socket);
  socket.on('error', (error: NodeJS.ErrnoException) => {
    if (isExpectedDisconnectError(error)) return;
    console.warn('HTTP socket error:', error.message);
  });
}

export function guardStreamResponse(res: Response) {
  if (guardedStreams.has(res)) return;
  guardedStreams.add(res);
  const markClosed = () => {
    closedStreams.add(res);
  };
  res.once('close', markClosed);
  res.once('finish', markClosed);
  res.once('error', markClosed);
  guardSocketError(res.socket);
  res.socket?.once('error', markClosed);
}

export function isStreamWritable(res: Response) {
  return !closedStreams.has(res) && !res.destroyed && !res.writableEnded && !res.headersSent
    ? true
    : !closedStreams.has(res) && !res.destroyed && !res.writableEnded;
}

export function writeStream(res: Response, payload: string) {
  guardStreamResponse(res);
  if (!isStreamWritable(res)) return false;
  try {
    return res.write(payload);
  } catch {
    closedStreams.add(res);
    return false;
  }
}

export function writeSseData(res: Response, data: unknown) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return writeStream(res, `data: ${payload}\n\n`);
}

export function endStream(res: Response) {
  guardStreamResponse(res);
  if (!isStreamWritable(res)) return;
  try {
    res.end();
  } catch {
    closedStreams.add(res);
  }
}
