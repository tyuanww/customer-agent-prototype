export type EnterLikeEvent = {
  key: string;
  keyCode?: number;
  which?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

export function isImeComposing(event: EnterLikeEvent): boolean {
  if (event.isComposing || event.nativeEvent?.isComposing) {
    return true;
  }
  const keyCode = event.keyCode ?? event.nativeEvent?.keyCode ?? event.which;
  return keyCode === 229;
}

export function shouldSubmitOnEnter(event: EnterLikeEvent): boolean {
  return event.key === 'Enter' && !isImeComposing(event);
}
