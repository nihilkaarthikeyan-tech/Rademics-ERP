import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Begin an upload (Spec §5.6). Provide a target (task or profile) for a new file,
 *  OR a fileAssetId to add a new version to an existing file. */
export class InitUploadDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1024 * 1024 * 1024) // 1 GiB hard ceiling; configured max enforced in service
  sizeBytes?: number;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  profileUserId?: string;

  @IsOptional()
  @IsUUID()
  fileAssetId?: string; // add a version to this existing file

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SetVisibilityDto {
  @IsIn(['INTERNAL', 'CLIENT_VISIBLE'])
  visibility!: 'INTERNAL' | 'CLIENT_VISIBLE';
}
