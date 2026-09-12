import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the mapping table.
 *
 * id1/id2 use a binary collation so identifiers stay case-sensitive, and the
 * unique index uq_user_mappings_id1_id2 is what makes "one userID per id1/id2
 * pair" true even when two requests arrive at the same moment.
 */
export class CreateUserMappingsTable1737000000000 implements MigrationInterface {
  name = 'CreateUserMappingsTable1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'CREATE TABLE user_mappings (',
        '  id INT UNSIGNED NOT NULL AUTO_INCREMENT,',
        '  id1 VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,',
        '  id2 VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,',
        '  user_id VARCHAR(36) COLLATE ascii_general_ci NOT NULL,',
        '  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),',
        '  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),',
        '  PRIMARY KEY (id),',
        '  UNIQUE INDEX uq_user_mappings_id1_id2 (id1, id2),',
        '  INDEX idx_user_mappings_user_id (user_id)',
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
      ].join('\n'),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE user_mappings');
  }
}
