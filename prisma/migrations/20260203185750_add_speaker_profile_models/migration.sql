-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOrganizer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SpeakerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "pronouns" TEXT,
    "company" TEXT,
    "roleTitle" TEXT,
    "location" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "bio" TEXT,
    "notes" TEXT,
    "linkedinUrl" TEXT,
    "websiteUrl" TEXT,
    "experienceLevel" TEXT NOT NULL DEFAULT 'SOME',
    "talkFormats" TEXT,
    "availableVirtual" BOOLEAN NOT NULL DEFAULT true,
    "availableInPerson" BOOLEAN NOT NULL DEFAULT true,
    "noticePeriodDays" INTEGER,
    "willingToTravel" BOOLEAN NOT NULL DEFAULT false,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "preferredContact" TEXT,
    "contactVisibility" TEXT NOT NULL DEFAULT 'ORGANIZERS_ONLY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakerProfileTopic" (
    "id" TEXT NOT NULL,
    "speakerProfileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "proficiency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerProfileTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakerEngagement" (
    "id" TEXT NOT NULL,
    "speakerProfileId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "talkTitle" TEXT,
    "eventDate" TIMESTAMP(3),
    "eventUrl" TEXT,
    "location" TEXT,
    "role" TEXT NOT NULL DEFAULT 'SPEAKER',
    "audienceSize" INTEGER,
    "videoUrl" TEXT,
    "slidesUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakerEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakerCredential" (
    "id" TEXT NOT NULL,
    "speakerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "credentialUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerProfile_userId_key" ON "SpeakerProfile"("userId");

-- CreateIndex
CREATE INDEX "SpeakerProfile_status_idx" ON "SpeakerProfile"("status");

-- CreateIndex
CREATE INDEX "SpeakerProfile_country_idx" ON "SpeakerProfile"("country");

-- CreateIndex
CREATE INDEX "SpeakerProfile_experienceLevel_idx" ON "SpeakerProfile"("experienceLevel");

-- CreateIndex
CREATE INDEX "SpeakerProfile_availableVirtual_idx" ON "SpeakerProfile"("availableVirtual");

-- CreateIndex
CREATE INDEX "SpeakerProfile_availableInPerson_idx" ON "SpeakerProfile"("availableInPerson");

-- CreateIndex
CREATE INDEX "SpeakerProfileTopic_speakerProfileId_idx" ON "SpeakerProfileTopic"("speakerProfileId");

-- CreateIndex
CREATE INDEX "SpeakerProfileTopic_tagId_idx" ON "SpeakerProfileTopic"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerProfileTopic_speakerProfileId_tagId_key" ON "SpeakerProfileTopic"("speakerProfileId", "tagId");

-- CreateIndex
CREATE INDEX "SpeakerEngagement_speakerProfileId_idx" ON "SpeakerEngagement"("speakerProfileId");

-- CreateIndex
CREATE INDEX "SpeakerCredential_speakerProfileId_idx" ON "SpeakerCredential"("speakerProfileId");

-- AddForeignKey
ALTER TABLE "SpeakerProfile" ADD CONSTRAINT "SpeakerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerProfileTopic" ADD CONSTRAINT "SpeakerProfileTopic_speakerProfileId_fkey" FOREIGN KEY ("speakerProfileId") REFERENCES "SpeakerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerProfileTopic" ADD CONSTRAINT "SpeakerProfileTopic_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerEngagement" ADD CONSTRAINT "SpeakerEngagement_speakerProfileId_fkey" FOREIGN KEY ("speakerProfileId") REFERENCES "SpeakerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerCredential" ADD CONSTRAINT "SpeakerCredential_speakerProfileId_fkey" FOREIGN KEY ("speakerProfileId") REFERENCES "SpeakerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
