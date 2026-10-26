import {
  shouldRevertDismissal,
  type PageContent,
} from './blocker-dismissal.service';

const content = (textChars: number, contentPoints: number): PageContent => ({
  textChars,
  contentPoints,
  totalPoints: 144,
});

describe('shouldRevertDismissal', () => {
  it('keeps a dismissal that removes a text-heavy dialog but reveals the page', () => {
    // dialog text gone, hero image behind it now visible
    expect(shouldRevertDismissal(content(1200, 60), content(300, 90))).toBe(
      false,
    );
  });

  it('reverts when the viewport goes blank', () => {
    expect(shouldRevertDismissal(content(1500, 70), content(0, 0))).toBe(true);
  });

  it('reverts when most of the content is lost', () => {
    expect(shouldRevertDismissal(content(2000, 100), content(400, 20))).toBe(
      true,
    );
  });

  it('does not revert a page that had no content to lose', () => {
    expect(shouldRevertDismissal(content(0, 0), content(0, 0))).toBe(false);
  });

  it('does not revert a page that was already nearly blank', () => {
    expect(shouldRevertDismissal(content(40, 4), content(30, 3))).toBe(false);
  });
});
