import { loadSchema } from '@zenstackhq/testtools';
import path from 'path';

describe('Polymorphism test', () => {
    let origDir: string;

    beforeAll(async () => {
        origDir = path.resolve('.');
    });

    afterEach(async () => {
        process.chdir(origDir);
    });

    const model = `
    generator client {
        provider = "prisma-client-js"
    }
      
    datasource db {
        provider = "sqlite"
        url      = "file:./dev.db"
    }
      
    model User {
      id Int @id @default(autoincrement())
      email String @unique
      name String?
      activity Activity[]
    }
    
    model Activity {
      id Int @id @default(autoincrement())
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt
      owner User @relation(fields: [ownerId], references: [id])
      ownerId Int

      @@delegate
    }
    
    model Post extends Activity {
      title String
      content String?
      published Boolean @default(false)
    }
    
    model Comment extends Activity {
      content String
    }      
    `;

    it('simple tests', async () => {
        await loadSchema(model, { addPrelude: false });
    });
});
