import SubmitEventForm from '@/components/SubmitEventForm';

export default function SubmitPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          Submit an Event
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Share an upcoming AdTech or media event with the community.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          All submissions are pending approval before appearing on the calendar.
        </p>
      </div>

      <SubmitEventForm />
    </div>
  );
}
