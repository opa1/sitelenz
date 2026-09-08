import { ScreenshotType } from '@prisma/client';
import { ScreenshotCaptureService } from './screenshot-capture.service';

type Mock = jest.Mock;

interface Harness {
  service: ScreenshotCaptureService;
  pngBuffer: Buffer;
  page: { goto: Mock; screenshot: Mock; close: Mock };
  context: { newPage: Mock };
  blocker: { dismissBlockers: Mock };
  cloudinary: { uploadScreenshot: Mock };
  prisma: { screenshot: { deleteMany: Mock; create: Mock } };
}

function makeHarness(): Harness {
  const pngBuffer = Buffer.from('png-bytes');
  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(pngBuffer),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const context = { newPage: jest.fn().mockResolvedValue(page) };
  const blocker = {
    dismissBlockers: jest
      .fn()
      .mockResolvedValue({ dismissed: false, method: 'none' }),
  };
  const cloudinary = {
    uploadScreenshot: jest.fn().mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/v1/sl.png',
      publicId: 'sitelenz/screenshots/sl_aj_1/sl_aj_1-desktop',
    }),
  };
  const prisma = {
    screenshot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new ScreenshotCaptureService(
    prisma as never,
    blocker as never,
    cloudinary as never,
  );
  return { service, pngBuffer, page, context, blocker, cloudinary, prisma };
}

describe('ScreenshotCaptureService', () => {
  it('captures, uploads, persists, and returns the entry', async () => {
    const h = makeHarness();
    const result = await h.service.capture(
      h.context as never,
      'https://example.com',
      'sl_aj_1',
      'desktop',
    );

    expect(h.page.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'load',
    });
    expect(h.page.screenshot).toHaveBeenCalledWith({
      fullPage: false,
      type: 'png',
      animations: 'disabled',
    });
    expect(h.cloudinary.uploadScreenshot).toHaveBeenCalledWith(
      h.pngBuffer,
      'sl_aj_1',
      'desktop',
    );
    expect(result.url).toBe(
      'https://res.cloudinary.com/demo/image/upload/v1/sl.png',
    );
    expect(result.cloudinaryPublicId).toBe(
      'sitelenz/screenshots/sl_aj_1/sl_aj_1-desktop',
    );
    expect(typeof result.takenAt).toBe('string');
  });

  it('is idempotent per (job, type): deletes any prior row before creating', async () => {
    const h = makeHarness();
    await h.service.capture(
      h.context as never,
      'https://example.com',
      'sl_aj_1',
      'desktop',
    );

    expect(h.prisma.screenshot.deleteMany).toHaveBeenCalledWith({
      where: { analyzeJobId: 'sl_aj_1', type: ScreenshotType.desktop },
    });
    expect(h.prisma.screenshot.create).toHaveBeenCalledTimes(1);
    // delete must run before create so a retry never leaves two rows.
    const deleteOrder =
      h.prisma.screenshot.deleteMany.mock.invocationCallOrder[0];
    const createOrder = h.prisma.screenshot.create.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it('maps the mobile type to the mobile enum', async () => {
    const h = makeHarness();
    await h.service.capture(
      h.context as never,
      'https://example.com',
      'sl_aj_1',
      'mobile',
    );
    expect(h.prisma.screenshot.deleteMany).toHaveBeenCalledWith({
      where: { analyzeJobId: 'sl_aj_1', type: ScreenshotType.mobile },
    });
    expect(h.prisma.screenshot.create).toHaveBeenCalledWith({
      data: {
        analyzeJobId: 'sl_aj_1',
        type: ScreenshotType.mobile,
        cloudinaryUrl: 'https://res.cloudinary.com/demo/image/upload/v1/sl.png',
        cloudinaryPublicId: 'sitelenz/screenshots/sl_aj_1/sl_aj_1-desktop',
      },
    });
  });

  it('tolerates blocker-dismissal failure without failing the capture', async () => {
    const h = makeHarness();
    h.blocker.dismissBlockers.mockRejectedValueOnce(new Error('overlay boom'));
    const entry = await h.service.capture(
      h.context as never,
      'https://example.com',
      'sl_aj_1',
      'desktop',
    );
    expect(typeof entry.cloudinaryPublicId).toBe('string');
    expect(h.page.screenshot).toHaveBeenCalled();
  });

  it('always closes the page, even when upload throws', async () => {
    const h = makeHarness();
    h.cloudinary.uploadScreenshot.mockRejectedValueOnce(new Error('cdn down'));
    await expect(
      h.service.capture(
        h.context as never,
        'https://example.com',
        'sl_aj_1',
        'desktop',
      ),
    ).rejects.toThrow('cdn down');
    expect(h.page.close).toHaveBeenCalledTimes(1);
    expect(h.prisma.screenshot.create).not.toHaveBeenCalled();
  });
});
