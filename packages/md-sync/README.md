# @mdeditor/md-sync

同步协议客户端（BYOS 自带服务器同步）。

- WebDAV 为主：服务端无需专用软件（Nextcloud / 群晖 / 坚果云 / 自建 nginx）
- 凭据不落配置：存系统密钥链，配置中仅存引用键
- P2：SFTP / Git / 自定义命令后端

```ts
import { syncPush } from '@mdeditor/md-sync';

await syncPush({
  protocol: 'webdav',
  url: 'https://my-server.com/dav/',
  localPath: '/docs',
  remotePath: '/md',
});
```
