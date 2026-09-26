import { YAMLStore } from './BaseStore';
import { Employee } from '../types';

export class EmployeeStore extends YAMLStore<Employee> {
  constructor(workspaceRoot?: string) {
    super('workforce', 'employees.yml', 'employees', workspaceRoot);
  }

  findByRole(role: Employee['role']): Employee[] {
    return this.loadAll().filter(e => e.role === role);
  }
}