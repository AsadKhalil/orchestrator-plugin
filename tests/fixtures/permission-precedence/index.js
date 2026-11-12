import { Plugin } from '@opencode/plugin';

// Disposable-host probe: session allows must not silently bypass project denies.
export default Plugin.define({
  id: 'feature-pilot-permission-precedence-probe',
  setup(ctx) {
    setTimeout(async () => {
      const session = await ctx.session.create({ permissions: [
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'read', resource: '*', effect: 'allow' },
        { action: 'glob', resource: '*', effect: 'allow' },
      ] });
      for (const [action, resource] of [['read', 'src/file.ts'], ['read', 'secret.txt'], ['glob', '*.ts'], ['edit', 'src/file.ts']]) {
        try {
          await ctx.permission.assert({ sessionID: session.id, action, resources: [resource] });
          console.log('PERMISSION_PROBE', action, resource, 'allowed');
        } catch {
          console.log('PERMISSION_PROBE', action, resource, 'denied');
        }
      }
    }, 1000);
  },
});
