import { avatarProblem } from '@/api/children';
import { pickedImageType } from '@/api/uploads';

// HEIC photos (iPhone, many Android phones): the pickers convert them to JPEG, and the
// content type comes from the file written, not the type the picker reports.

test('a HEIC photo Android re-encoded to .jpeg is sent as JPEG, not its reported HEIC', () => {
  const type = pickedImageType(
    'file:///data/user/0/com.superpowerapp/cache/ImagePicker/abc.jpeg',
    'image/heic',
  );
  expect(type).toBe('image/jpeg');
  expect(avatarProblem(type, 1000)).toBeNull();
});

test('the iOS compatible export (.jpg) and the other allowed formats keep their type', () => {
  expect(pickedImageType('file:///tmp/ImagePicker/1.jpg', 'image/jpeg')).toBe(
    'image/jpeg',
  );
  expect(pickedImageType('file:///tmp/2.PNG', null)).toBe('image/png');
  expect(pickedImageType('file:///tmp/3.webp', 'image/webp')).toBe(
    'image/webp',
  );
  expect(pickedImageType('file:///tmp/4.gif?x=1', undefined)).toBe('image/gif');
});

test('a file still in HEIC keeps that type, so the check names it', () => {
  const type = pickedImageType('file:///tmp/5.heic', 'image/heic');
  expect(type).toBe('image/heic');
  expect(avatarProblem(type, 1000)).toMatch(/JPEG, PNG, WebP or GIF/);
});
