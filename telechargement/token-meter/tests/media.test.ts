import { expect, test } from 'claude-code/testing'

import { BIG_IMAGE_BYTES, agentDefs, judgeMedia, quietCommand } from '../hooks/media'

const S = '/p/scripts/media.py'

test('a video is never read: info and contact sheet are offered instead', () => {
  const v = judgeMedia('/r/rush.MOV', 2_000_000_000, S)
  expect(v.kind).toBe('deny')
  if (v.kind === 'deny') {
    expect(v.why).toBe('video')
    expect(v.reason).toContain('planche')
    expect(v.reason).toContain(S)
  }
})

test('a heavy image is sent to a reduced preview; a light one goes through', () => {
  const big = judgeMedia('/r/photo.jpg', BIG_IMAGE_BYTES + 1, S)
  expect(big.kind).toBe('deny')
  if (big.kind === 'deny') expect(big.reason).toContain('apercu')
  expect(judgeMedia('/r/logo.png', 40_000, S).kind).toBe('allow')
  expect(judgeMedia('/r/chapitre.md', 9_000_000, S).kind).toBe('allow')
})

test('ffmpeg and ffprobe lose their banner and progress, and nothing else changes', () => {
  expect(quietCommand('ffmpeg -i a.mp4 b.mp4')).toBe('ffmpeg -hide_banner -nostats -i a.mp4 b.mp4')
  expect(quietCommand('cd x && /usr/bin/ffprobe -i a.mp4')).toBe('cd x && /usr/bin/ffprobe -hide_banner -i a.mp4')
  expect(quietCommand('ffmpeg -hide_banner -i a b')).toBe('ffmpeg -hide_banner -i a b')
  expect(quietCommand('echo myffmpeg -i')).toBe('echo myffmpeg -i')
  expect(quietCommand('ls -la')).toBe('ls -la')
})

test('PyInstaller runs at WARN unless a level is already set', () => {
  expect(quietCommand('pyinstaller --onefile app.py')).toBe('pyinstaller --log-level WARN --onefile app.py')
  expect(quietCommand('python -m PyInstaller app.spec')).toBe('python -m PyInstaller --log-level WARN app.spec')
  expect(quietCommand('pyinstaller --log-level DEBUG app.py')).toBe('pyinstaller --log-level DEBUG app.py')
})

test('the three subagents point at the scripts shipped with the mod', () => {
  const defs = agentDefs('/p')
  expect(defs.map(d => d.name)).toEqual(['media', 'setup-exe', 'lecteur'])
  expect(defs[0]?.prompt).toContain('/p/scripts/media.py')
  expect(defs[1]?.prompt).toContain('/p/scripts/build_setup.py')
})
