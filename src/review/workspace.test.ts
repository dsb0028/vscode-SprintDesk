import assert from 'node:assert/strict';
import { resolveReviewWorkspace } from './workspace';

const linux = [{ path: '/home/owner/AUGuard', fsPath: '/home/owner/AUGuard' }];
const windows = [{ path: '/C:/Projects/AUGuard', fsPath: 'c:\\Projects\\AUGuard' }];
assert.equal(resolveReviewWorkspace('vscode-remote://ssh-remote%2Bhost/home/owner/AUGuard', linux),
  '/home/owner/AUGuard');
assert.equal(resolveReviewWorkspace('vscode-remote://ssh-remote%2Bhost/C:/Projects/AUGuard', windows),
  'c:\\Projects\\AUGuard');
assert.equal(resolveReviewWorkspace('file:///home/owner/AUGuard', linux), linux[0].fsPath);
assert.equal(resolveReviewWorkspace(linux[0].fsPath, linux), linux[0].fsPath);
assert.equal(resolveReviewWorkspace('vscode-remote://ssh-remote%2Bhost/home/owner/AU%20Guard',
  [{ path: '/home/owner/AU Guard', fsPath: '/home/owner/AU Guard' }]), '/home/owner/AU Guard');
assert.throws(() => resolveReviewWorkspace('\\home\\owner\\AUGuard', linux), /exact open/);
assert.throws(() => resolveReviewWorkspace('vscode-remote://ssh-remote%2Bother/wrong', linux), /exact open/);
assert.throws(() => resolveReviewWorkspace('https://host/home/owner/AUGuard', linux), /Unsupported/);
assert.throws(() => resolveReviewWorkspace('file://network/home/owner/AUGuard', linux), /ambiguous/);
assert.throws(() => resolveReviewWorkspace('file:///home/owner/AUGuard?query=1', linux), /ambiguous/);
assert.throws(() => resolveReviewWorkspace('file:///home/owner/AUGuard#fragment', linux), /ambiguous/);
assert.throws(() => resolveReviewWorkspace('file:///home/owner/AUGuard', []), /exact open/);
assert.throws(() => resolveReviewWorkspace('file:///home/owner/AUGuard', [...linux, ...linux]), /exact open/);
console.log('Cross-platform review workspace routing tests passed');
