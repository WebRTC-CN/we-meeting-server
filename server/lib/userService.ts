import { v4 } from 'uuid';
import jwt from 'jsonwebtoken';

const userNameMap: Map<string, string> = new Map();
const secret_key = '123456';
const token_expires_in = 3600; // seconds

export type UserInfo = {
  id: string;
  name: string;
}

export function createUser(name: string) : UserInfo {
  const id = v4();
  userNameMap.set(id, name);
  return {
    id,
    name,
  };
}

export function getUserInfo(id: string) : UserInfo | undefined {
  const name = userNameMap.get(id);
  if (name) {
    return {
      id,
      name,
    };
  }
  return undefined;
}

export function sign(userInfo: UserInfo) {
  return jwt.sign({
    ...userInfo
  }, secret_key, {
    expiresIn: token_expires_in
  });
}

export function verify(token: string): Promise<any> {
  let userInfo: UserInfo;
  return new Promise((resovle, reject) => {
    jwt.verify(token, secret_key, (err, userInfo) => {
      if (err || userInfo === undefined) {
        reject(err);
      } else {
        resovle({
          ...userInfo
        });
      }
    });
  })
}