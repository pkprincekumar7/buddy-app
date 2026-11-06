import { localFile, postToS3 } from '@/api/uploads';

describe('presigned S3 form uploads (APP-07)', () => {
  it('sends a picked file by its URI, named for its type', () => {
    expect(localFile('file:///tmp/a.png', 'image/png')).toEqual({
      uri: 'file:///tmp/a.png',
      name: 'photo.png',
      type: 'image/png',
    });
  });

  it('appends the signed fields first and the file last', async () => {
    const appended: string[] = [];
    const append = jest
      .spyOn(FormData.prototype, 'append')
      .mockImplementation(function (this: FormData, name: string) {
        appended.push(name);
      });
    globalThis.fetch = jest.fn(
      async () => new Response(null, { status: 204 }),
    ) as typeof fetch;
    try {
      await postToS3(
        'https://s3.test/bucket',
        { key: 'k', policy: 'p' },
        localFile('file:///tmp/a.jpg', 'image/jpeg'),
      );
    } finally {
      append.mockRestore();
    }
    expect(appended).toEqual(['key', 'policy', 'file']);
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
      postToS3('https://s3.test/bucket', {}, new Blob(['x'])),
    ).rejects.toThrow('The photo upload failed (400).');
  });
});
