#!/usr/bin/env node

const EventEmitter = require('events');

function stdinLineByLine() {
  const stdin = new EventEmitter();
  let buff = "";

  process.stdin
    .on('data', data => {
      buff += data;
      lines = buff.split(/[\r\n|\n]/);
      buff = lines.pop();
      lines.forEach(line => stdin.emit('line', line));
    })
    .on('end', () => {
      if (buff.length > 0) stdin.emit('line', buff);
    });

  return stdin;
}

const stdin = stdinLineByLine();
stdin.on('line', console.log);
