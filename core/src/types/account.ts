export {};
export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  uin: string;
  qq: string;
  avatar: string;
  nick?: string;
  /** 卡密授权到期时间；null 表示永久，缺省表示未启用卡密管控。 */
  expiresAt?: number | null;
  /** 归属的普通用户名；空表示由超级管理员直接管理。 */
  owner?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}
