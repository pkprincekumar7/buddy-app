import { postToS3 } from '@/api/uploads';

describe('presigned S3 form uploads (APP-07)', () => {
  it('appends the signed fields first and the file last, as a named Blob', async () => {
    const appended: unknown[][] = [];
    const append = jest
      .spyOn(FormData.prototype, 'append')
      .mockImplementation(function (this: FormData, ...args: unknown[]) {
        appended.push(args);
      });
    globalThis.fetch = jest.fn(
      async () => new Response(null, { status: 204 }),
    ) as typeof fetch;
    const photo = new Blob(['jpeg bytes']);
    try {
      await postToS3(
        'https://s3.test/bucket',
        { key: 'k', policy: 'p' },
        photo,
        'image/jpeg',
      );
    } finally {
      append.mockRestore();
    }
    expect(appended.map(([name]) => name)).toEqual(['key', 'policy', 'file']);
    // The bytes themselves, never a { uri } part: Expo's fetch (the global fetch on SDK
    // 56) refuses those with "Unsupported FormDataPart implementation".
    expect(appended[2]).toEqual(['file', photo, 'photo.jpeg']);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://s3.test/bucket',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a refused upload is an error', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('EntityTooLarge', { status: 400 }),
    ) as typeof fetch;
    await expect(
      postToS3('https://s3.test/bucket', {}, new Blob(['x']), 'image/png'),
    ).rejects.toThrow('The photo upload failed (400).');
  });
});
