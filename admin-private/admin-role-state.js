((root) => {
  "use strict";

  function shouldRefreshTarget(input) {
    return Boolean(
      input &&
      input.targetUserId &&
      input.targetUserId === input.selectedUserId &&
      input.startedLookupRequestId === input.currentLookupRequestId
    );
  }

  root.BBBBAdminRoleState = Object.freeze({
    shouldRefreshTarget
  });
})(globalThis);
