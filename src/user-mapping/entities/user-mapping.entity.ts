import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Maps an (id1, id2) pair to a stable userID.
 *
 * The table is append-only: a row is inserted once and never updated afterwards,
 * which is what makes the Redis cache safe to serve without invalidation.
 * The unique constraint is the authority that keeps one pair mapped to one userID.
 */
@Entity('user_mappings')
@Unique('uq_user_mappings_id1_id2', ['id1', 'id2'])
export class UserMapping {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ name: 'id1', type: 'varchar', length: 64 })
  id1: string;

  @Column({ name: 'id2', type: 'varchar', length: 64 })
  id2: string;

  @Index('idx_user_mappings_user_id')
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
