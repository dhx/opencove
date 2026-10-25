// Loaded with NODE_OPTIONS=--require into the worker and every Node process it starts (release check, see
// scripts/dhx/egress-smoke.sh). Records each attempt to reach anything but loopback or a local socket, one
// line per attempt, to $OPENCOVE_EGRESS_LOG. The check fails when the file is not empty.
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const dns = require('node:dns')

const log = process.env.OPENCOVE_EGRESS_LOG
const local = host =>
  !host ||
  host === 'localhost' ||
  host === '::1' ||
  /^127\./.test(host) ||
  /^::ffff:127\./.test(host)

function record(kind, target) {
  if (!log) {
    return
  }
  try {
    fs.appendFileSync(
      log,
      `${process.pid} ${kind} ${target} ${process.argv.slice(1, 2).join(' ')}\n`,
    )
  } catch {}
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const first = args[0]
  const options = Array.isArray(first) ? first[0] : first
  if (options && typeof options === 'object' && !options.path) {
    if (!local(options.host)) {
      record('connect', `${options.host}:${options.port}`)
    }
  } else if (typeof first === 'number' && !local(args[1])) {
    record('connect', `${args[1] ?? 'localhost'}:${first}`)
  }
  return connect.apply(this, args)
}

for (const api of [dns, dns.promises]) {
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
    const original = api[name]
    if (typeof original !== 'function') {
      continue
    }
    api[name] = function (host, ...rest) {
      if (!local(host)) {
        record(`dns.${name}`, host)
      }
      return original.call(this, host, ...rest)
    }
  }
}
